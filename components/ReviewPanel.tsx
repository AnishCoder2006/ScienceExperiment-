"use client";

import { timeAgo } from "@/lib/format";
import { CheckIcon, XIcon } from "./icons";

export type Decision = "approved" | "rejected";

export interface Review {
  decision: Decision | null;
  note: string;
  updatedAt: string;
}

interface Props {
  conceptName: string;
  review: Review | undefined;
  /** False until localStorage has been read, so we never overwrite saved reviews. */
  loaded: boolean;
  onChange: (patch: Partial<Review>) => void;
}

export function ReviewPanel({ conceptName, review, loaded, onChange }: Props) {
  const decision = review?.decision ?? null;
  // Clicking the active button again clears the decision.
  const toggle = (d: Decision) => onChange({ decision: decision === d ? null : d });

  return (
    <div className="space-y-3">
      <div role="group" aria-label={`Review ${conceptName}`} className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          disabled={!loaded}
          aria-pressed={decision === "approved"}
          onClick={() => toggle("approved")}
          className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold ring-1 ring-inset transition-all duration-300 active:scale-95 disabled:opacity-50 ${
            decision === "approved"
              ? "animate-pop bg-pass text-white shadow-[0_8px_20px_-8px_var(--pass)] ring-pass dark:text-bg"
              : "bg-surface text-fg ring-border-strong hover:bg-pass-soft hover:text-pass hover:ring-pass/40"
          }`}
        >
          <CheckIcon width={16} height={16} strokeWidth={2.5} />
          {decision === "approved" ? "Approved" : "Approve"}
        </button>
        <button
          type="button"
          disabled={!loaded}
          aria-pressed={decision === "rejected"}
          onClick={() => toggle("rejected")}
          className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold ring-1 ring-inset transition-all duration-300 active:scale-95 disabled:opacity-50 ${
            decision === "rejected"
              ? "animate-pop bg-fail text-white shadow-[0_8px_20px_-8px_var(--fail)] ring-fail dark:text-bg"
              : "bg-surface text-fg ring-border-strong hover:bg-fail-soft hover:text-fail hover:ring-fail/40"
          }`}
        >
          <XIcon width={16} height={16} strokeWidth={2.5} />
          {decision === "rejected" ? "Rejected" : "Reject"}
        </button>
      </div>

      <label className="block">
        <span className="sr-only">Note for {conceptName}</span>
        <textarea
          rows={3}
          disabled={!loaded}
          value={review?.note ?? ""}
          onChange={(e) => onChange({ note: e.target.value })}
          placeholder="Teacher's note, e.g. what is wrong or what to change…"
          className="block w-full resize-y rounded-xl bg-surface px-3 py-2 text-sm leading-6 text-fg ring-1 ring-inset ring-border-strong transition-shadow duration-300 placeholder:text-subtle focus:shadow-[0_0_0_4px_var(--accent-soft)] focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
        />
      </label>

      <p className="text-xs text-subtle" aria-live="polite">
        {!loaded
          ? "Loading saved review…"
          : review?.updatedAt
            ? `Saved in this browser ${timeAgo(review.updatedAt)}`
            : "Not reviewed yet"}
      </p>
    </div>
  );
}
