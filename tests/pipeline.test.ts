import { afterEach, describe, expect, it, vi } from "vitest";
import { CONCEPTS } from "../lib/concepts";
import { callGemini } from "../lib/gemini";
import { generateDiagram } from "../lib/pipeline";

// These tests replace fetch with a fake Gemini, so they run offline and cost nothing.

const concept = CONCEPTS[0];

const GOOD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><title>Pythagoras</title>
<text x="100" y="100">hypotenuse</text><text x="100" y="150">a² + b² = c²</text><text x="100" y="200">b</text>
<circle cx="50" cy="50" r="5"><animate attributeName="r" values="5;8;5" dur="2s" repeatCount="indefinite"/></circle></svg>`;
/** Valid but with a label running off the right edge and no animation. */
const BAD_SVG = GOOD_SVG.replace('x="100" y="100"', 'x="780" y="100"').replace(/<circle[\s\S]*<\/circle>/, "");

const ok = (text: string, usage = { promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 10 }) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: usage }), {
    status: 200,
  });

const error = (status: number, message: string, retryDelay?: string) =>
  new Response(
    JSON.stringify({ error: { code: status, message, details: retryDelay ? [{ retryDelay }] : [] } }),
    { status },
  );

afterEach(() => vi.unstubAllGlobals());

describe("callGemini", () => {
  it("retries a 429 and a 503, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(error(429, "Resource exhausted", "0.01s"))
      .mockResolvedValueOnce(error(503, "Overloaded", "0.01s"))
      .mockResolvedValueOnce(ok(GOOD_SVG));
    vi.stubGlobal("fetch", fetchMock);
    const onRetry = vi.fn();

    const reply = await callGemini({ apiKey: "k", model: "m", system: "s", messages: [{ role: "user", text: "hi" }], onRetry });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(reply.apiRetries).toBe(2);
    expect(reply.usage).toEqual({ inputTokens: 100, outputTokens: 60, thinkingTokens: 10 });
  });

  it("gives up after 3 retries with a clear message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => error(429, "Resource exhausted", "0.01s")));
    await expect(
      callGemini({ apiKey: "k", model: "m", system: "s", messages: [{ role: "user", text: "hi" }] }),
    ).rejects.toThrow(/429\) still hit after 3 retries/);
  });

  it("does not retry a bad key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(error(400, "API key not valid. Please pass a valid API key."));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      callGemini({ apiKey: "k", model: "m", system: "s", messages: [{ role: "user", text: "hi" }] }),
    ).rejects.toThrow(/API key was rejected/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("explains a missing model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(error(404, "models/x is not found")));
    await expect(
      callGemini({ apiKey: "k", model: "x", system: "s", messages: [{ role: "user", text: "hi" }] }),
    ).rejects.toThrow(/Model "x" was not found/);
  });
});

describe("generateDiagram", () => {
  it("passes first time without a retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(GOOD_SVG)));
    const result = await generateDiagram(concept, { apiKey: "k", model: "gemini-3.5-flash-lite" });
    expect(result.status).toBe("pass");
    expect(result.retries).toEqual({ validation: 0, api: 0, total: 0 });
    // 100 input × $0.30/M + 60 output × $2.50/M
    expect(result.costUsd).toBeCloseTo(0.00018, 8);
  });

  it("retries once with the failed checks in the prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(BAD_SVG)).mockResolvedValueOnce(ok(GOOD_SVG));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateDiagram(concept, { apiKey: "k", model: "gemini-3.5-flash-lite" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const feedback = retryBody.contents.at(-1).parts[0].text as string;
    expect(retryBody.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
    expect(feedback).toMatch(/Inside viewBox: .*right edge/);
    expect(feedback).toMatch(/Animated: No animation found/);
    expect(result.status).toBe("pass");
    expect(result.chosenAttempt).toBe(2);
    expect(result.retries.validation).toBe(1);
    expect(result.usage.inputTokens).toBe(200);
  });

  it("retries only once, then keeps the better attempt", async () => {
    const worse = "no svg here";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok(BAD_SVG)).mockResolvedValueOnce(ok(worse)));
    const result = await generateDiagram(concept, { apiKey: "k", model: "gemini-3.5-flash-lite" });
    expect(result.attempts).toHaveLength(2);
    expect(result.chosenAttempt).toBe(1);
    expect(result.status).toBe("fail");
  });

  it("keeps attempt 1 if the retry call itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok(BAD_SVG)).mockResolvedValueOnce(error(400, "API key not valid")));
    const result = await generateDiagram(concept, { apiKey: "k", model: "gemini-3.5-flash-lite" });
    expect(result.attempts).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/Retry call failed/);
  });

  it("fails clearly without a key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(generateDiagram(concept, {})).rejects.toThrow(/GEMINI_API_KEY is not set/);
    vi.unstubAllEnvs();
  });
});
