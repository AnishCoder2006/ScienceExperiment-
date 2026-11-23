// Shared types for the generator pipeline, the API route and the UI.

/** The ids of the checks we run on every SVG. */
export type CheckId =
  | "valid"
  | "inViewBox"
  | "labels"
  | "animated"
  | "keyTerms"
  | "safe";

export interface CheckResult {
  id: CheckId;
  label: string;
  passed: boolean;
  /** Human readable reason. On failure this text is sent back to the model. */
  detail: string;
}

export interface Concept {
  id: number;
  name: string;
  subject: "Maths" | "Physics" | "Biology" | "Chemistry";
  /** The exact text from the assignment that we give to the model. */
  text: string;
  /** GCSE terms that must appear in the labels (our own check). */
  keyTerms: KeyTerm[];
}

export interface KeyTerm {
  /** What we show in error messages, e.g. "carbon dioxide (CO2)". */
  name: string;
  /** Matched against the lower-cased, normalised label text. */
  pattern: RegExp;
}

export interface TokenUsage {
  inputTokens: number;
  /** Visible output tokens plus thinking tokens (both are billed as output). */
  outputTokens: number;
  thinkingTokens: number;
}

/** One call to the model and the checks run on what it returned. */
export interface AttemptLog {
  attempt: number;
  usage: TokenUsage;
  costUsd: number;
  durationMs: number;
  /** How many times this call was retried because of 429/503/network errors. */
  apiRetries: number;
  finishReason: string;
  checks: CheckResult[];
  /** The feedback we sent to the model for the next attempt, if any. */
  feedbackSent?: string;
}

export interface DiagramResult {
  conceptId: number;
  concept: string;
  subject: Concept["subject"];
  model: string;
  status: "pass" | "fail";
  /** The SVG from the best attempt. */
  svg: string;
  checks: CheckResult[];
  /** Totals across every attempt. */
  usage: TokenUsage;
  costUsd: number;
  retries: {
    /** Re-asks because a check failed (max 1). */
    validation: number;
    /** Re-sends because of 429/503/network errors (max 3 per call). */
    api: number;
    total: number;
  };
  /** Which attempt was kept as the final result (1-based). */
  chosenAttempt: number;
  attempts: AttemptLog[];
  /** Things that went wrong but did not stop us, e.g. the retry call itself failed. */
  warnings: string[];
  durationMs: number;
  generatedAt: string;
}

export interface ResultsFile {
  generatedAt: string;
  results: DiagramResult[];
}

/** Progress events streamed from /api/generate to the browser. */
export type PipelineEvent =
  | { type: "status"; message: string }
  | { type: "attempt"; attempt: number; failed: string[] }
  | { type: "result"; result: DiagramResult }
  | { type: "error"; message: string };
