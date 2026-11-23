import type { TokenUsage } from "./types";

// A minimal Gemini REST client. We use fetch directly instead of the SDK so that
// every step (request, retries, error messages, token counts) is visible here.

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
/** The assignment asks us to retry 429 and 503 errors up to 3 times. */
export const MAX_API_RETRIES = 3;
/** Never wait longer than this for one retry. Longer waits mean the daily quota is gone. */
const MAX_WAIT_MS = 60_000;
/** One model call may not take longer than this. */
const REQUEST_TIMEOUT_MS = 180_000;

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export interface ChatMessage {
  role: "user" | "model";
  text: string;
}

export interface GeminiReply {
  text: string;
  finishReason: string;
  usage: TokenUsage;
  apiRetries: number;
  durationMs: number;
}

export interface RetryInfo {
  retry: number;
  reason: string;
  waitMs: number;
}

export interface CallOptions {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  /** Epoch ms. Give up with a clear error instead of running past this time. */
  deadline?: number;
  onRetry?: (info: RetryInfo) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Gemini sends the suggested wait in error.details[].retryDelay, e.g. "17s". */
function suggestedWaitMs(body: unknown): number | undefined {
  const details = (body as { error?: { details?: { retryDelay?: string }[] } })?.error?.details ?? [];
  const delay = details.find((d) => d.retryDelay)?.retryDelay;
  const seconds = delay ? parseFloat(delay) : NaN;
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : undefined;
}

/** Turn an HTTP error into a message a reviewer can act on. */
function friendlyError(status: number, apiMessage: string, model: string): GeminiError {
  if (status === 400 && /api key/i.test(apiMessage)) {
    return new GeminiError("The Gemini API key was rejected. Check GEMINI_API_KEY.", status);
  }
  if (status === 403) return new GeminiError(`The API key is not allowed to use Gemini (403): ${apiMessage}`, status);
  if (status === 404) {
    return new GeminiError(`Model "${model}" was not found (404). Set GEMINI_MODEL to a model your key can use.`, status);
  }
  if (status === 429) {
    return new GeminiError(
      `Gemini rate limit (429) still hit after ${MAX_API_RETRIES} retries. Free-tier limits are low: wait a minute and try again.`,
      status,
    );
  }
  if (status === 503) {
    return new GeminiError(`Gemini is overloaded (503) after ${MAX_API_RETRIES} retries. Try again in a minute.`, status);
  }
  return new GeminiError(`Gemini API error ${status}: ${apiMessage}`, status);
}

export async function callGemini(opts: CallOptions): Promise<GeminiReply> {
  const { apiKey, model, system, messages, deadline = Infinity, onRetry } = opts;
  const started = Date.now();
  const url = `${API_BASE}/${encodeURIComponent(model)}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    generationConfig: { temperature: 0.4, maxOutputTokens: 16384 },
  });

  for (let retry = 0; ; retry++) {
    const timeLeft = deadline - Date.now();
    if (timeLeft <= 1000) throw new GeminiError("Ran out of time waiting for Gemini. Try again in a minute.");

    // Wait for a response, or abort when the request takes too long.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, timeLeft));
    let res: Response | undefined;
    let networkError: string | undefined;
    try {
      res = await fetch(url, {
        method: "POST",
        // The key goes in a header, never in the URL, so it cannot leak into logs.
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
        signal: controller.signal,
      });
    } catch (e) {
      networkError = controller.signal.aborted ? "request timed out" : e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
    }

    if (res?.ok) {
      const data = await res.json();
      const candidate = data.candidates?.[0];
      if (!candidate) {
        const reason = data.promptFeedback?.blockReason ?? "no candidates returned";
        throw new GeminiError(`Gemini returned no diagram (${reason}).`);
      }
      // Gemini 3 models may return "thought" parts; only keep the visible answer.
      const text = (candidate.content?.parts ?? [])
        .filter((p: { thought?: boolean; text?: string }) => !p.thought && p.text)
        .map((p: { text: string }) => p.text)
        .join("");
      const meta = data.usageMetadata ?? {};
      const thinkingTokens = meta.thoughtsTokenCount ?? 0;
      return {
        text,
        finishReason: candidate.finishReason ?? "UNKNOWN",
        usage: {
          inputTokens: meta.promptTokenCount ?? 0,
          outputTokens: (meta.candidatesTokenCount ?? 0) + thinkingTokens,
          thinkingTokens,
        },
        apiRetries: retry,
        durationMs: Date.now() - started,
      };
    }

    // Read the error body (if any) so we can show Gemini's own message.
    let errorBody: unknown;
    if (res) errorBody = await res.json().catch(() => undefined);
    const status = res?.status;
    const apiMessage =
      (errorBody as { error?: { message?: string } })?.error?.message ?? networkError ?? `HTTP ${status}`;

    const retryable = status === 429 || status === 503 || networkError !== undefined;
    if (!retryable) throw friendlyError(status ?? 0, apiMessage, model);
    if (retry >= MAX_API_RETRIES) {
      if (networkError) throw new GeminiError(`Could not reach Gemini after ${MAX_API_RETRIES} retries: ${networkError}.`);
      throw friendlyError(status!, apiMessage, model);
    }

    // Exponential backoff (2s, 4s, 8s) plus jitter, unless Gemini tells us how long to wait.
    const suggested = suggestedWaitMs(errorBody);
    if (suggested && suggested > MAX_WAIT_MS) {
      throw new GeminiError(
        `Gemini quota exhausted (429): it asked us to wait ${Math.round(suggested / 1000)}s. The free daily limit may be used up.`,
        status,
      );
    }
    const waitMs = suggested ?? 2000 * 2 ** retry + Math.floor(Math.random() * 500);
    if (Date.now() + waitMs > deadline) {
      throw new GeminiError(
        `Gemini is busy (${status ?? "network"}) and asked us to wait ${Math.round(waitMs / 1000)}s, which is past the time limit. Try again shortly.`,
        status,
      );
    }
    onRetry?.({ retry: retry + 1, reason: status ? `HTTP ${status}` : networkError!, waitMs });
    await sleep(waitMs);
  }
}
