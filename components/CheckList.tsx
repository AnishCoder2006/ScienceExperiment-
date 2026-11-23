import { OWN_CHECKS } from "@/lib/checkInfo";
import type { CheckResult } from "@/lib/types";
import { CheckIcon, XIcon } from "./icons";

/** The pass/fail list for one diagram. Hover or focus a check to read the full reason. */
export function CheckList({ checks, idPrefix }: { checks: CheckResult[]; idPrefix: string }) {
  return (
    <ul className="space-y-0.5">
      {checks.map((check) => (
        <li key={check.id} className="group relative">
          <div
            tabIndex={0}
            aria-describedby={`${idPrefix}-tip-${check.id}`}
            className="flex cursor-default items-start gap-2 rounded-md px-1.5 py-1 outline-none hover:bg-surface-2 focus-visible:bg-surface-2"
          >
            <span
              className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full ${
                check.passed ? "bg-pass-soft text-pass" : "bg-fail text-white dark:text-bg"
              }`}
            >
              {check.passed ? (
                <CheckIcon width={10} height={10} strokeWidth={3.5} />
              ) : (
                <XIcon width={10} height={10} strokeWidth={3.5} />
              )}
              <span className="sr-only">{check.passed ? "Pass" : "Fail"}</span>
            </span>
            <span className="min-w-0 text-[13px] leading-5">
              <span className={check.passed ? "text-fg" : "font-medium text-fail"}>{check.label}</span>
              {OWN_CHECKS.includes(check.id) && (
                <span className="ml-1.5 rounded bg-surface-2 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-subtle ring-1 ring-inset ring-border">
                  own
                </span>
              )}
              {!check.passed && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{check.detail}</span>}
            </span>
          </div>
          <div
            id={`${idPrefix}-tip-${check.id}`}
            role="tooltip"
            className="pointer-events-none invisible absolute left-0 top-full z-30 mt-1 w-72 rounded-lg bg-fg px-3 py-2 text-xs leading-relaxed text-bg opacity-0 shadow-card transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
          >
            {check.detail}
          </div>
        </li>
      ))}
    </ul>
  );
}
