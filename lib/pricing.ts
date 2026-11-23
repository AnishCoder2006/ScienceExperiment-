import type { TokenUsage } from "./types";

export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

/**
 * Paid-tier prices in USD per 1 million tokens. We use the free tier, so the real bill is $0;
 * this is what the same calls would cost on a paid key. Thinking tokens are billed as output.
 * Source: third-party price listings (Nov 2026) that quote Google's pricing page.
 * Check https://ai.google.dev/pricing before relying on these numbers.
 */
export const PRICES_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.5-flash": { input: 1.5, output: 9.0 },
};

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  // Unknown models fall back to flash-lite prices so the column is never empty.
  const price = PRICES_PER_MILLION[model] ?? PRICES_PER_MILLION[DEFAULT_MODEL];
  const cost = (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}
