"use client";

import { useEffect, useRef, useState } from "react";
import { CHECK_DESCRIPTIONS } from "@/lib/checkInfo";
import { formatDate, formatDuration, formatInt, formatUsd } from "@/lib/format";
import type { Concept, DiagramResult } from "@/lib/types";
import { AlertIcon, CheckIcon, CopyIcon, DownloadIcon, XIcon } from "./icons";
import { DiagramPreview } from "./DiagramPreview";
import { Button, StatusBadge, SubjectChip } from "./ui";

type Tab = "checks" | "attempts" | "source";

interface Props {
  concept: Concept;
  result: DiagramResult;
  onClose: () => void;
}

/** Full detail view for one diagram, in a native <dialog> (focus trap and Esc for free). */
export function DiagramModal({ concept, result, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>("checks");

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // A click on the backdrop lands on the <dialog> itself, so close.
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      aria-labelledby="modal-title"
      className="m-auto max-h-[92vh] w-[calc(100%-32px)] max-w-5xl overflow-hidden rounded-2xl bg-surface p-0 text-fg shadow-2xl ring-1 ring-border backdrop:bg-transparent"
    >
      <div className="flex max-h-[92vh] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="modal-title" className="text-lg font-semibold tracking-tight">
                {concept.id}. {concept.name}
              </h2>
              <SubjectChip subject={concept.subject} />
              <StatusBadge status={result.status} />
            </div>
            <p className="mt-1 text-xs text-muted">
              {result.model} · generated {formatDate(result.generatedAt)} · kept attempt {result.chosenAttempt} of{" "}
              {result.attempts.length}
            </p>
          </div>
          <Button variant="ghost" aria-label="Close" onClick={() => ref.current?.close()} className="-mr-2 -mt-1 px-2">
            <XIcon width={18} height={18} />
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[1.35fr_1fr] md:overflow-hidden">
          <div className="space-y-4 border-border p-5 md:overflow-y-auto md:border-r">
            <DiagramPreview svg={result.svg} alt={`Animated diagram: ${concept.name}`} />
            <figure className="rounded-xl bg-surface-2 p-4 ring-1 ring-inset ring-border">
              <figcaption className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">
                Text given to the model
              </figcaption>
              <blockquote className="text-sm leading-relaxed text-muted">{concept.text}</blockquote>
            </figure>
            {result.warnings.length > 0 && (
              <div className="flex gap-2 rounded-xl bg-warn-soft p-3 text-sm text-warn">
                <AlertIcon className="mt-0.5 shrink-0" />
                <div>{result.warnings.join(" ")}</div>
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-col">
            <div role="tablist" className="flex gap-1 border-b border-border px-5 pt-3">
              {(["checks", "attempts", "source"] as Tab[]).map((t) => (
                <button
                  key={t}
                  role="tab"
                  type="button"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`-mb-px border-b-2 px-3 pb-2.5 text-[13px] font-medium capitalize transition ${
                    tab === t ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"
                  }`}
                >
                  {t === "source" ? "SVG source" : t}
                </button>
              ))}
            </div>
            <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-5">
              {tab === "checks" && <ChecksTab result={result} />}
              {tab === "attempts" && <AttemptsTab result={result} />}
              {tab === "source" && <SourceTab result={result} concept={concept} />}
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function ChecksTab({ result }: { result: DiagramResult }) {
  return (
    <ul className="space-y-3">
      {result.checks.map((c) => (
        <li key={c.id} className="flex gap-3">
          <span
            className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${
              c.passed ? "bg-pass-soft text-pass" : "bg-fail-soft text-fail"
            }`}
          >
            {c.passed ? <CheckIcon width={12} height={12} strokeWidth={3} /> : <XIcon width={12} height={12} strokeWidth={3} />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{c.label}</p>
            <p className="text-xs leading-relaxed text-muted">{c.detail}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-subtle">{CHECK_DESCRIPTIONS[c.id]}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-subtle">{label}</dt>
      <dd className="font-mono text-[13px] tabular-nums">{value}</dd>
    </div>
  );
}

function AttemptsTab({ result }: { result: DiagramResult }) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-3 gap-3 rounded-xl bg-surface-2 p-3 ring-1 ring-inset ring-border">
        <Stat label="Total cost" value={formatUsd(result.costUsd)} />
        <Stat label="Input tokens" value={formatInt(result.usage.inputTokens)} />
        <Stat label="Output tokens" value={formatInt(result.usage.outputTokens)} />
        <Stat label="Check retries" value={String(result.retries.validation)} />
        <Stat label="API retries" value={String(result.retries.api)} />
        <Stat label="Time" value={formatDuration(result.durationMs)} />
      </dl>

      <ol className="space-y-3">
        {result.attempts.map((a) => {
          const failed = a.checks.filter((c) => !c.passed);
          return (
            <li key={a.attempt} className="rounded-xl p-3 ring-1 ring-inset ring-border">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  Attempt {a.attempt}
                  {a.attempt === result.chosenAttempt && (
                    <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                      kept
                    </span>
                  )}
                </p>
                <span className={`text-xs font-medium ${failed.length ? "text-fail" : "text-pass"}`}>
                  {failed.length ? `${failed.length} check(s) failed` : "All checks passed"}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2">
                <Stat label="In / out tokens" value={`${formatInt(a.usage.inputTokens)} / ${formatInt(a.usage.outputTokens)}`} />
                <Stat label="Cost" value={formatUsd(a.costUsd)} />
                <Stat label="API retries" value={String(a.apiRetries)} />
                <Stat label="Thinking tokens" value={formatInt(a.usage.thinkingTokens)} />
                <Stat label="Finish" value={a.finishReason} />
                <Stat label="Time" value={formatDuration(a.durationMs)} />
              </dl>
              {failed.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-fail">
                  {failed.map((c) => (
                    <li key={c.id}>
                      <span className="font-medium">{c.label}:</span> <span className="text-muted">{c.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
              {a.feedbackSent && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-accent">Feedback sent to the model</summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface-2 p-2.5 font-mono text-[11px] leading-relaxed text-muted ring-1 ring-inset ring-border">
                    {a.feedbackSent}
                  </pre>
                </details>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SourceTab({ result, concept }: { result: DiagramResult; concept: Concept }) {
  const [copied, setCopied] = useState(false);
  const sizeKb = (new Blob([result.svg]).size / 1024).toFixed(1);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.svg);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${concept.id}-${concept.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{sizeKb} KB</span>
        <div className="flex gap-1.5">
          <Button onClick={copy}>
            {copied ? <CheckIcon width={14} height={14} /> : <CopyIcon width={14} height={14} />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button onClick={download}>
            <DownloadIcon width={14} height={14} /> Download
          </Button>
        </div>
      </div>
      <pre className="max-h-[50vh] overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-muted ring-1 ring-inset ring-border">
        {result.svg || "(empty)"}
      </pre>
    </div>
  );
}
