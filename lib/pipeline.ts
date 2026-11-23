import { runChecks } from "./checks";
import { GeminiError, callGemini, type ChatMessage, type GeminiReply } from "./gemini";
import { DEFAULT_MODEL, estimateCostUsd } from "./pricing";
import { SYSTEM_PROMPT, buildPrompt, buildRetryPrompt } from "./prompt";
import type { AttemptLog, Concept, DiagramResult, PipelineEvent, TokenUsage } from "./types";

// Part A for one concept:
//   1. ask the model for an SVG
//   2. run every check on it
//   3. if a check failed, retry ONCE and tell the model what failed
//   4. keep the better attempt and return it with tokens, cost and retries.

/** 1 first attempt + 1 retry with feedback. */
const MAX_ATTEMPTS = 2;

export interface PipelineOptions {
  apiKey?: string;
  model?: string;
  /** Epoch ms. The API route sets this so we stop before the host kills the request. */
  deadline?: number;
  onEvent?: (event: PipelineEvent) => void;
}

const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  thinkingTokens: a.thinkingTokens + b.thinkingTokens,
});

export async function generateDiagram(concept: Concept, opts: PipelineOptions = {}): Promise<DiagramResult> {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not set, so we cannot call Gemini.");
  const model = opts.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const emit = opts.onEvent ?? (() => {});
  const started = Date.now();

  const messages: ChatMessage[] = [{ role: "user", text: buildPrompt(concept) }];
  const attempts: AttemptLog[] = [];
  const svgs: (string | null)[] = [];
  const warnings: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    emit({ type: "status", message: attempt === 1 ? `Asking ${model} for a diagram…` : "Asking the model to fix it…" });

    let reply: GeminiReply;
    try {
      reply = await callGemini({
        apiKey,
        model,
        system: SYSTEM_PROMPT,
        messages,
        deadline: opts.deadline,
        onRetry: ({ retry, reason, waitMs }) =>
          emit({ type: "status", message: `Gemini returned ${reason}. Waiting ${Math.round(waitMs / 1000)}s (API retry ${retry}/3)…` }),
      });
    } catch (e) {
      // If the first call fails there is nothing to show, so the error goes to the caller.
      // If the retry call fails we still have attempt 1, so we keep it and record a warning.
      if (attempt === 1) throw e;
      const message = e instanceof Error ? e.message : String(e);
      warnings.push(`Retry call failed, kept attempt 1: ${message}`);
      emit({ type: "status", message: `Retry call failed (${message}). Keeping attempt 1.` });
      break;
    }

    const { svg, checks } = runChecks(reply.text, concept);
    const failed = checks.filter((c) => !c.passed);
    const log: AttemptLog = {
      attempt,
      usage: reply.usage,
      costUsd: estimateCostUsd(model, reply.usage),
      durationMs: reply.durationMs,
      apiRetries: reply.apiRetries,
      finishReason: reply.finishReason,
      checks,
    };
    attempts.push(log);
    svgs.push(svg);
    emit({ type: "attempt", attempt, failed: failed.map((c) => c.label) });

    if (failed.length === 0 || attempt === MAX_ATTEMPTS) break;

    // Retry once: show the model its own answer and exactly which checks failed.
    log.feedbackSent = buildRetryPrompt(failed, reply.finishReason);
    messages.push({ role: "model", text: reply.text }, { role: "user", text: log.feedbackSent });
  }

  // Keep the attempt with the fewest failed checks. On a tie, keep the later one.
  let best = 0;
  attempts.forEach((a, i) => {
    const fails = a.checks.filter((c) => !c.passed).length;
    const bestFails = attempts[best].checks.filter((c) => !c.passed).length;
    if (fails <= bestFails) best = i;
  });
  const chosen = attempts[best];

  const usage = attempts.reduce((sum, a) => addUsage(sum, a.usage), { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 });
  const apiRetries = attempts.reduce((sum, a) => sum + a.apiRetries, 0);
  const validationRetries = attempts.length - 1;

  const result: DiagramResult = {
    conceptId: concept.id,
    concept: concept.name,
    subject: concept.subject,
    model,
    status: chosen.checks.every((c) => c.passed) ? "pass" : "fail",
    svg: svgs[best] ?? "",
    checks: chosen.checks,
    usage,
    costUsd: estimateCostUsd(model, usage),
    retries: { validation: validationRetries, api: apiRetries, total: validationRetries + apiRetries },
    chosenAttempt: chosen.attempt,
    attempts,
    warnings,
    durationMs: Date.now() - started,
    generatedAt: new Date().toISOString(),
  };
  logResult(result);
  return result;
}

/** One log line per concept with everything the assignment asks us to log. */
export function logResult(r: DiagramResult): void {
  const checks = r.checks.map((c) => `${c.passed ? "✓" : "✗"} ${c.label}`).join(", ");
  console.log(
    `[${r.status.toUpperCase()}] ${r.concept} | model=${r.model} | in=${r.usage.inputTokens} out=${r.usage.outputTokens}` +
      ` (thinking ${r.usage.thinkingTokens}) | cost=$${r.costUsd.toFixed(6)}` +
      ` | retries=${r.retries.total} (validation ${r.retries.validation}, api ${r.retries.api}) | ${checks}`,
  );
}
