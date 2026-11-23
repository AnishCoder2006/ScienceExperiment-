// Small shared building blocks.

import type { Concept } from "@/lib/types";
import { CheckIcon, XIcon } from "./icons";

const SUBJECT_STYLES: Record<Concept["subject"], string> = {
  Maths: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 ring-indigo-500/20",
  Physics: "bg-amber-500/10 text-amber-800 dark:text-amber-300 ring-amber-500/25",
  Biology: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 ring-emerald-500/25",
  Chemistry: "bg-fuchsia-500/10 text-fuchsia-800 dark:text-fuchsia-300 ring-fuchsia-500/25",
};

export function SubjectChip({ subject }: { subject: Concept["subject"] }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${SUBJECT_STYLES[subject]}`}>
      {subject}
    </span>
  );
}

export function StatusBadge({ status }: { status: "pass" | "fail" }) {
  const pass = status === "pass";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
        pass ? "bg-pass-soft text-pass" : "bg-fail-soft text-fail"
      }`}
    >
      {pass ? <CheckIcon width={12} height={12} strokeWidth={3} /> : <XIcon width={12} height={12} strokeWidth={3} />}
      {pass ? "All checks pass" : "Checks failed"}
    </span>
  );
}

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  const styles = {
    primary: "bg-accent text-accent-fg hover:bg-accent-hover shadow-subtle",
    secondary: "bg-surface text-fg ring-1 ring-inset ring-border-strong hover:bg-surface-2 shadow-subtle",
    ghost: "text-muted hover:text-fg hover:bg-surface-2",
  }[variant];
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}
