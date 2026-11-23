"use client";

import { useMemo, useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { CHECK_DESCRIPTIONS, CHECK_LABELS, CHECK_ORDER, OWN_CHECKS } from "@/lib/checkInfo";
import { CONCEPTS } from "@/lib/concepts";
import { formatDate, formatInt, formatUsd } from "@/lib/format";
import type { Concept, DiagramResult, PipelineEvent } from "@/lib/types";
import { CheckList } from "./CheckList";
import { DiagramModal } from "./DiagramModal";
import { DiagramPreview } from "./DiagramPreview";
import { AlertIcon, CheckIcon, InfoIcon, SparkIcon, Spinner, UndoIcon, XIcon } from "./icons";
import { ReviewPanel, type Review } from "./ReviewPanel";
import { Button, StatusBadge, SubjectChip } from "./ui";

interface Step {
  text: string;
  tone: "info" | "pass" | "fail";
}

/** State of a live "Generate" run for one concept. Not saved: it only lives while the page is open. */
interface Job {
  running: boolean;
  steps: Step[];
  error?: string;
}

interface Props {
  saved: DiagramResult[];
  savedAt: string;
}

export function Dashboard({ saved, savedAt }: Props) {
  // Reviews and live results are saved in localStorage (see README for why).
  const [reviews, setReviews, reviewsLoaded] = useLocalStorage<Record<number, Review>>("sdm:reviews:v1", {});
  const [live, setLive] = useLocalStorage<Record<number, DiagramResult>>("sdm:live-results:v1", {});
  const [jobs, setJobs] = useState<Record<number, Job>>({});
  const [openId, setOpenId] = useState<number | null>(null);

  const savedById = useMemo(() => new Map(saved.map((r) => [r.conceptId, r])), [saved]);
  const rows = CONCEPTS.map((concept) => ({
    concept,
    result: live[concept.id] ?? savedById.get(concept.id),
    isLive: Boolean(live[concept.id]),
    review: reviews[concept.id],
    job: jobs[concept.id],
  }));
  const anyRunning = rows.some((r) => r.job?.running);

  const updateReview = (id: number, patch: Partial<Review>) =>
    setReviews((prev) => {
      const current: Review = prev[id] ?? { decision: null, note: "", updatedAt: "" };
      return { ...prev, [id]: { ...current, ...patch, updatedAt: new Date().toISOString() } };
    });

  const updateJob = (id: number, update: (job: Job) => Job) =>
    setJobs((prev) => ({ ...prev, [id]: update(prev[id] ?? { running: false, steps: [] }) }));

  /** Runs Part A live through /api/generate and shows each streamed step. */
  async function generate(concept: Concept) {
    const id = concept.id;
    setJobs((prev) => ({ ...prev, [id]: { running: true, steps: [{ text: "Starting…", tone: "info" }] } }));
    const addStep = (step: Step) => updateJob(id, (j) => ({ ...j, steps: [...j.steps, step] }));

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptId: id }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `The server answered ${res.status} ${res.statusText}.`);
      }

      // The response is NDJSON: read it chunk by chunk and handle each complete line.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const event = JSON.parse(line) as PipelineEvent;
          if (event.type === "status") addStep({ text: event.message, tone: "info" });
          if (event.type === "attempt") {
            addStep(
              event.failed.length
                ? { text: `Attempt ${event.attempt} failed: ${event.failed.join(", ")}`, tone: "fail" }
                : { text: `Attempt ${event.attempt}: all checks passed`, tone: "pass" },
            );
          }
          if (event.type === "result") {
            finished = true;
            setLive((prev) => ({ ...prev, [id]: event.result }));
            // A new diagram needs a new decision; the note is kept.
            if (reviews[id]?.decision) updateReview(id, { decision: null });
          }
          if (event.type === "error") {
            finished = true;
            throw new Error(event.message);
          }
        }
      }
      if (!finished) throw new Error("The connection closed before a result arrived. The server may have timed out.");
      updateJob(id, (j) => ({ ...j, running: false }));
    } catch (e) {
      const message =
        e instanceof TypeError ? "Could not reach the server. Check your connection and try again." : (e as Error).message;
      updateJob(id, (j) => ({ ...j, running: false, error: message }));
    }
  }

  function revert(id: number) {
    setLive((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setJobs((prev) => ({ ...prev, [id]: { running: false, steps: [] } }));
    if (reviews[id]?.decision) updateReview(id, { decision: null });
  }

  const results = rows.map((r) => r.result).filter((r): r is DiagramResult => Boolean(r));
  const stats = {
    passing: results.filter((r) => r.status === "pass").length,
    cost: results.reduce((s, r) => s + r.costUsd, 0),
    inputTokens: results.reduce((s, r) => s + r.usage.inputTokens, 0),
    outputTokens: results.reduce((s, r) => s + r.usage.outputTokens, 0),
    validationRetries: results.reduce((s, r) => s + r.retries.validation, 0),
    apiRetries: results.reduce((s, r) => s + r.retries.api, 0),
    approved: rows.filter((r) => r.review?.decision === "approved").length,
    rejected: rows.filter((r) => r.review?.decision === "rejected").length,
  };
  const model = results[0]?.model ?? "gemini-3.5-flash-lite";
  const open = rows.find((r) => r.concept.id === openId);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="relative overflow-hidden border-b border-border bg-surface">
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-4 pb-8 pt-10 sm:px-6 lg:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Udhi Technologies · GCSE diagrams</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Science Diagram Maker</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">
                An AI model draws an animated SVG for each concept. Code checks every diagram and retries once with the
                reasons when a check fails. A person makes the final call.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 font-mono text-muted ring-1 ring-inset ring-border">
                <span className="size-1.5 rounded-full bg-accent" /> {model}
              </span>
              {savedAt && (
                <span className="inline-flex items-center rounded-full bg-surface px-3 py-1 text-muted ring-1 ring-inset ring-border">
                  Saved run · {formatDate(savedAt)}
                </span>
              )}
            </div>
          </div>

          {/* Stats */}
          <dl className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Diagrams passing all checks" value={`${stats.passing} / ${CONCEPTS.length}`}>
              <Meter value={stats.passing} max={CONCEPTS.length} />
            </StatCard>
            <StatCard label="Estimated cost (paid tier)" value={formatUsd(stats.cost)}>
              {formatInt(stats.inputTokens)} in · {formatInt(stats.outputTokens)} out tokens
            </StatCard>
            <StatCard label="Retries" value={String(stats.validationRetries + stats.apiRetries)}>
              {stats.validationRetries} after failed checks · {stats.apiRetries} after API errors
            </StatCard>
            <StatCard
              label="Reviewed"
              value={reviewsLoaded ? `${stats.approved + stats.rejected} / ${CONCEPTS.length}` : "–"}
            >
              <span className="text-pass">{stats.approved} approved</span> ·{" "}
              <span className="text-fail">{stats.rejected} rejected</span>
            </StatCard>
          </dl>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <ChecksLegend />

        {saved.length === 0 && (
          <div className="mb-6 flex gap-3 rounded-xl bg-warn-soft p-4 text-sm text-warn ring-1 ring-inset ring-warn/30">
            <AlertIcon className="mt-0.5 shrink-0" />
            <p>
              No saved results yet. Run <code className="font-mono">npm run generate</code> to create{" "}
              <code className="font-mono">results.json</code>, or press Generate on a row.
            </p>
          </div>
        )}

        <div className="lg:overflow-visible lg:rounded-2xl lg:bg-surface lg:shadow-card lg:ring-1 lg:ring-border">
          <table className="review-table w-full border-separate border-spacing-0 text-left">
            <caption className="sr-only">Generated diagrams with check results, cost, retries and review</caption>
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wide text-subtle">
                <th scope="col" className="w-[19%] border-b border-border px-5 py-3">Concept</th>
                <th scope="col" className="w-[27%] border-b border-border px-5 py-3">Diagram</th>
                <th scope="col" className="w-[21%] border-b border-border px-5 py-3">Checks</th>
                <th scope="col" className="w-[12%] border-b border-border px-5 py-3">Cost &amp; retries</th>
                <th scope="col" className="w-[21%] border-b border-border px-5 py-3">Review</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ concept, result, isLive, review, job }, i) => {
                const last = i === rows.length - 1;
                const cell = `align-top px-5 py-5 ${last ? "" : "border-b border-border"}`;
                const currentStep = job?.steps.at(-1)?.text;
                return (
                  <tr key={concept.id} className="animate-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
                    {/* Concept */}
                    <td className={cell}>
                      <div className="flex gap-3">
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-2 font-mono text-xs font-semibold text-muted ring-1 ring-inset ring-border">
                          {concept.id}
                        </span>
                        <div className="min-w-0 space-y-1.5">
                          <p className="font-semibold leading-tight">{concept.name}</p>
                          <div className="flex flex-wrap gap-1.5">
                            <SubjectChip subject={concept.subject} />
                          </div>
                          {result && <StatusBadge status={result.status} />}
                          <p className="line-clamp-3 text-xs leading-relaxed text-muted" title={concept.text}>
                            {concept.text}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Diagram + live generate */}
                    <td className={cell} data-label="Diagram">
                      <DiagramPreview
                        svg={result?.svg}
                        alt={`Animated diagram: ${concept.name}`}
                        busyMessage={job?.running ? currentStep : undefined}
                        onOpen={() => setOpenId(concept.id)}
                      />
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          variant="primary"
                          onClick={() => generate(concept)}
                          disabled={anyRunning}
                          title={anyRunning && !job?.running ? "One generation at a time, to respect the free API limits" : undefined}
                        >
                          {job?.running ? <Spinner width={14} height={14} /> : <SparkIcon width={14} height={14} />}
                          {job?.running ? "Generating…" : result ? "Regenerate live" : "Generate"}
                        </Button>
                        {isLive && !job?.running && (
                          <Button variant="ghost" onClick={() => revert(concept.id)} title="Go back to the result saved in results.json">
                            <UndoIcon width={14} height={14} /> Revert to saved
                          </Button>
                        )}
                      </div>
                      {isLive && !job?.running && !job?.error && (
                        <p className="mt-2 text-[11px] text-subtle">Showing a live result, kept in this browser.</p>
                      )}
                      {job && (job.running || job.error || job.steps.length > 1) && <JobLog job={job} />}
                    </td>

                    {/* Checks */}
                    <td className={cell} data-label="Checks">
                      {result ? (
                        <CheckList checks={result.checks} idPrefix={`c${concept.id}`} />
                      ) : (
                        <p className="text-sm text-subtle">Not generated yet</p>
                      )}
                    </td>

                    {/* Cost and retries */}
                    <td className={cell} data-label="Cost & retries">
                      {result ? (
                        <div className="space-y-3">
                          <div>
                            <p className="font-mono text-base font-semibold tabular-nums">{formatUsd(result.costUsd)}</p>
                            <p className="text-[11px] leading-relaxed text-subtle">
                              {formatInt(result.usage.inputTokens)} in
                              <br />
                              {formatInt(result.usage.outputTokens)} out
                            </p>
                          </div>
                          <div>
                            <p className="text-sm font-semibold">
                              {result.retries.total} {result.retries.total === 1 ? "retry" : "retries"}
                            </p>
                            <p className="text-[11px] leading-relaxed text-subtle">
                              {result.retries.validation} check · {result.retries.api} API
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-subtle">–</p>
                      )}
                    </td>

                    {/* Review */}
                    <td className={cell} data-label="Review">
                      <ReviewPanel
                        conceptName={concept.name}
                        review={review}
                        loaded={reviewsLoaded}
                        onChange={(patch) => updateReview(concept.id, patch)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className="mt-8 flex flex-col gap-1 text-xs text-subtle sm:flex-row sm:justify-between">
          <p>Reviews and live results are stored in this browser (localStorage). Diagrams render inside &lt;img&gt;, so no script in them can run.</p>
          <p>Costs are estimates at paid-tier prices. The free tier costs $0.</p>
        </footer>
      </main>

      {open?.result && <DiagramModal concept={open.concept} result={open.result} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function StatCard({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface p-4 shadow-subtle ring-1 ring-inset ring-border">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums tracking-tight">{value}</dd>
      {children && <dd className="mt-1.5 text-[11px] text-subtle">{children}</dd>}
    </div>
  );
}

function Meter({ value, max }: { value: number; max: number }) {
  return (
    <div className="flex gap-1" aria-hidden>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`h-1.5 flex-1 rounded-full ${i < value ? "bg-pass" : "bg-border"}`} />
      ))}
    </div>
  );
}

function JobLog({ job }: { job: Job }) {
  return (
    <div className="mt-3 rounded-lg bg-surface-2 p-2.5 ring-1 ring-inset ring-border" aria-live="polite">
      {job.error && (
        <div role="alert" className="mb-2 flex gap-2 rounded-md bg-fail-soft p-2 text-xs text-fail">
          <AlertIcon width={14} height={14} className="mt-px shrink-0" />
          <div>
            <p className="font-semibold">Generation failed</p>
            <p className="leading-relaxed">{job.error}</p>
          </div>
        </div>
      )}
      <ol className="space-y-1">
        {job.steps.slice(1).map((s, i) => (
          <li key={i} className="flex gap-1.5 text-[11px] leading-snug text-muted">
            {s.tone === "pass" ? (
              <CheckIcon width={12} height={12} className="mt-px shrink-0 text-pass" />
            ) : s.tone === "fail" ? (
              <XIcon width={12} height={12} className="mt-px shrink-0 text-fail" />
            ) : (
              <span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-subtle" />
            )}
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ChecksLegend() {
  return (
    <details className="group mb-6 rounded-xl bg-surface p-4 shadow-subtle ring-1 ring-inset ring-border">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
        <InfoIcon className="text-accent" />
        How each diagram is checked
        <span className="ml-auto text-xs text-subtle group-open:hidden">Show</span>
        <span className="ml-auto hidden text-xs text-subtle group-open:inline">Hide</span>
      </summary>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CHECK_ORDER.map((id) => (
          <li key={id} className="rounded-lg bg-surface-2 p-3 ring-1 ring-inset ring-border">
            <p className="text-[13px] font-semibold">
              {CHECK_LABELS[id]}
              {OWN_CHECKS.includes(id) && <span className="ml-1.5 text-[10px] font-medium uppercase text-accent">own check</span>}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{CHECK_DESCRIPTIONS[id]}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">
        If any check fails, the model is asked once more with the exact reasons. 429 and 503 API errors are retried up to 3
        times with backoff.
      </p>
    </details>
  );
}
