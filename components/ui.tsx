// Small shared building blocks.

import type { Concept } from "@/lib/types";
import { BoltIcon, CheckIcon, FlaskIcon, LeafIcon, TriangleRulerIcon, XIcon } from "./icons";

type Subject = Concept["subject"];

/** One friendly colour per subject, used for chips and the stripe on each row. */
export const SUBJECT_THEME: Record<Subject, { chip: string; stripe: string; tile: string; Icon: typeof BoltIcon }> = {
  Maths: {
    chip: "bg-sky-500/10 text-sky-800 dark:text-sky-300 ring-sky-500/25",
    stripe: "bg-sky-500",
    tile: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
    Icon: TriangleRulerIcon,
  },
  Physics: {
    chip: "bg-amber-500/12 text-amber-800 dark:text-amber-300 ring-amber-500/30",
    stripe: "bg-amber-500",
    tile: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    Icon: BoltIcon,
  },
  Biology: {
    chip: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 ring-emerald-500/25",
    stripe: "bg-emerald-500",
    tile: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    Icon: LeafIcon,
  },
  Chemistry: {
    chip: "bg-rose-500/10 text-rose-800 dark:text-rose-300 ring-rose-500/25",
    stripe: "bg-rose-500",
    tile: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
    Icon: FlaskIcon,
  },
};

export function SubjectChip({ subject }: { subject: Subject }) {
  const { chip, Icon } = SUBJECT_THEME[subject];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${chip}`}>
      <Icon width={12} height={12} />
      {subject}
    </span>
  );
}

export function SubjectTile({ subject }: { subject: Subject }) {
  const { tile, Icon } = SUBJECT_THEME[subject];
  return (
    <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${tile}`} aria-hidden>
      <Icon width={22} height={22} />
    </span>
  );
}

export function StatusBadge({ status }: { status: "pass" | "fail" }) {
  const pass = status === "pass";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        pass ? "bg-pass-soft text-pass" : "bg-fail-soft text-fail"
      }`}
    >
      {pass ? <CheckIcon width={13} height={13} strokeWidth={3} /> : <XIcon width={13} height={13} strokeWidth={3} />}
      {pass ? "All checks pass" : "Some checks failed"}
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
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}
