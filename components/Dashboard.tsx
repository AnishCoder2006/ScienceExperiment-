"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { CHECK_DESCRIPTIONS, CHECK_LABELS, CHECK_ORDER, OWN_CHECKS } from "@/lib/checkInfo";
import { CONCEPTS } from "@/lib/concepts";
import { formatDate, formatInt, formatUsd, svgDataUri } from "@/lib/format";
import type { CheckId, Concept, DiagramResult, PipelineEvent } from "@/lib/types";
import { CheckList } from "./CheckList";
import { DiagramModal } from "./DiagramModal";
import { DiagramPreview } from "./DiagramPreview";
import {
  AlertIcon,
  ArrowRightIcon,
  AtomIcon,
  BookIcon,
  CheckIcon,
  CodeIcon,
  FrameIcon,
  GithubIcon,
  LightbulbIcon,
  MenuIcon,
  PencilIcon,
  PlayIcon,
  ShieldCheckIcon,
  SparkIcon,
  Spinner,
  TagIcon,
  TeacherIcon,
  UndoIcon,
  XIcon,
} from "./icons";
import { CountUp, Reveal, Tilt, useReveal } from "./motion";
import { ReviewPanel, type Review } from "./ReviewPanel";
import { Button, StatusBadge, SubjectChip, SubjectTile } from "./ui";

const REPO_URL = "https://github.com/AnishCoder2006/ScienceExperiment-";

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
  const models = [...new Set(results.map((r) => r.model))];
  const open = rows.find((r) => r.concept.id === openId);
  const heroRow = rows.find((r) => r.result?.status === "pass") ?? rows.find((r) => r.result);

  return (
    <div className="min-h-screen">
      <NavBar passing={stats.passing} total={CONCEPTS.length} />

      {/* Hero */}
      <header className="relative overflow-hidden">
        <div className="hero-bg pointer-events-none absolute inset-0" aria-hidden />
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="blob blob-a left-[8%] top-[18%] size-[26rem] bg-accent/25" />
          <div className="blob blob-b right-[4%] top-[8%] size-[22rem] bg-accent-3/20" />
        </div>
        <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] items-center gap-12 px-4 pb-16 pt-32 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:px-8 lg:pb-24 lg:pt-40">
          <div>
            <a
              href="#checks"
              style={{ "--d": "0ms" } as React.CSSProperties}
              className="animate-enter group inline-flex items-center gap-2 rounded-full bg-surface/70 py-1 pl-1 pr-3 text-sm text-muted ring-1 ring-inset ring-border backdrop-blur transition hover:text-fg hover:ring-accent/40"
            >
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-fg">New</span>
              6 automatic checks on every diagram
              <ArrowRightIcon width={14} height={14} className="transition-transform duration-300 group-hover:translate-x-1" />
            </a>
            <h1
              style={{ "--d": "100ms" } as React.CSSProperties}
              className="animate-enter mt-6 text-[2.6rem] font-extrabold leading-[1.05] sm:text-6xl"
            >
              Science diagrams that <span className="text-gradient">come alive</span>
            </h1>
            <p style={{ "--d": "220ms" } as React.CSSProperties} className="animate-enter mt-6 max-w-xl text-lg leading-relaxed text-muted">
              Animated GCSE diagrams for Maths, Physics, Biology and Chemistry. AI draws them, code checks them, and a
              teacher approves them before they reach the classroom.
            </p>
            <div style={{ "--d": "340ms" } as React.CSSProperties} className="animate-enter mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#diagrams"
                className="btn-shine group inline-flex items-center gap-2 rounded-xl bg-fg px-5 py-3 text-[15px] font-semibold text-bg shadow-card transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-10px_var(--glow)] active:translate-y-0"
              >
                Review the diagrams{" "}
                <ArrowRightIcon width={16} height={16} className="transition-transform duration-300 group-hover:translate-x-1" />
              </a>
              <a
                href="#how"
                className="inline-flex items-center gap-2 rounded-xl bg-surface px-5 py-3 text-[15px] font-semibold ring-1 ring-inset ring-border-strong transition duration-300 hover:-translate-y-0.5 hover:bg-surface-2 hover:ring-accent/40 active:translate-y-0"
              >
                How it works
              </a>
            </div>
            <div style={{ "--d": "460ms" } as React.CSSProperties} className="animate-enter mt-8 flex flex-wrap items-center gap-2">
              {(["Maths", "Physics", "Biology", "Chemistry"] as const).map((s) => (
                <span key={s} className="transition-transform duration-300 hover:-translate-y-0.5">
                  <SubjectChip subject={s} />
                </span>
              ))}
            </div>
          </div>

          <div style={{ "--d": "250ms" } as React.CSSProperties} className="animate-enter-pop">
            <HeroPreview row={heroRow} onOpen={(id) => setOpenId(id)} />
          </div>
        </div>
      </header>

      {/* Metrics band */}
      <section aria-label="Run summary" className="border-y border-border bg-surface/60 backdrop-blur">
        <dl className="mx-auto grid max-w-7xl grid-cols-2 divide-border px-4 sm:px-6 lg:grid-cols-4 lg:divide-x lg:px-8">
          <Metric
            delay={0}
            label="Diagrams passing every check"
            value={<CountUp value={stats.passing} format={(n) => `${Math.round(n)}/${CONCEPTS.length}`} />}
          >
            <Meter value={stats.passing} max={CONCEPTS.length} />
          </Metric>
          <Metric delay={80} label="Estimated cost (paid tier)" value={<CountUp value={stats.cost} format={formatUsd} />}>
            {formatInt(stats.inputTokens)} tokens in · {formatInt(stats.outputTokens)} out
          </Metric>
          <Metric
            delay={160}
            label="Retries"
            value={<CountUp value={stats.validationRetries + stats.apiRetries} format={(n) => String(Math.round(n))} />}
          >
            {stats.validationRetries} after failed checks · {stats.apiRetries} after API errors
          </Metric>
          <Metric
            delay={240}
            label="Reviewed by a teacher"
            value={
              reviewsLoaded ? (
                <CountUp value={stats.approved + stats.rejected} duration={500} format={(n) => `${Math.round(n)}/${CONCEPTS.length}`} />
              ) : (
                "–"
              )
            }
          >
            <span className="text-pass">{stats.approved} approved</span> ·{" "}
            <span className="text-fail">{stats.rejected} rejected</span>
          </Metric>
        </dl>
      </section>

      <main>
        <HowItWorks />

        {/* Review queue: the table required by the brief */}
        <section id="diagrams" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <Reveal className="flex flex-wrap items-end justify-between gap-4">
            <SectionHeading
              eyebrow="Review queue"
              title="Five concepts, ready for review"
              text="Every diagram the AI drew, with its check results, cost and retries. Approve or reject each one and leave a note."
            />
            <div className="flex flex-wrap gap-2 text-xs">
              {models.map((m) => (
                <span key={m} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-muted ring-1 ring-inset ring-border">
                  <span className="size-1.5 rounded-full bg-accent" />
                  <span className="font-mono">{m}</span>
                </span>
              ))}
              {savedAt && (
                <span className="inline-flex items-center rounded-full bg-surface px-3 py-1.5 text-muted ring-1 ring-inset ring-border">
                  Saved run · {formatDate(savedAt)}
                </span>
              )}
            </div>
          </Reveal>

          {saved.length === 0 && (
            <div className="mt-8 flex gap-3 rounded-2xl bg-warn-soft p-4 text-[15px] text-warn ring-1 ring-inset ring-warn/30">
              <AlertIcon className="mt-0.5 shrink-0" />
              <p>
                No saved results yet. Run <code className="font-mono">npm run generate</code> to create{" "}
                <code className="font-mono">results.json</code>, or press Generate on a row.
              </p>
            </div>
          )}

          <div className="mt-10 lg:overflow-visible lg:rounded-3xl lg:bg-surface lg:shadow-card lg:ring-1 lg:ring-border">
            <table className="review-table w-full border-separate border-spacing-0 text-left">
              <caption className="sr-only">Generated diagrams with check results, cost, retries and review</caption>
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-wider text-subtle">
                  <th scope="col" className="w-[44%] rounded-tl-3xl border-b border-border bg-surface-2/60 px-6 py-4">Concept &amp; diagram</th>
                  <th scope="col" className="w-[20%] border-b border-border bg-surface-2/60 px-6 py-4">Checks</th>
                  <th scope="col" className="w-[14%] border-b border-border bg-surface-2/60 px-6 py-4">Cost &amp; retries</th>
                  <th scope="col" className="w-[22%] rounded-tr-3xl border-b border-border bg-surface-2/60 px-6 py-4">Teacher review</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ concept, result, isLive, review, job }, i) => {
                  const last = i === rows.length - 1;
                  const cell = `align-top px-6 py-7 ${last ? "" : "border-b border-border"}`;
                  const currentStep = job?.steps.at(-1)?.text;
                  return (
                    <Reveal as="tr" key={concept.id} delay={60} className="transition-colors duration-300 lg:hover:bg-surface-2/40">
                      {/* Concept + diagram + live generate */}
                      <td className={cell}>
                        <div className="flex items-start gap-3">
                          <SubjectTile subject={concept.subject} />
                          <div className="min-w-0 flex-1">
                            <h3 className="text-xl font-bold leading-tight">
                              <span className="text-subtle">{String(concept.id).padStart(2, "0")}</span> {concept.name}
                            </h3>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <SubjectChip subject={concept.subject} />
                              {result && <StatusBadge status={result.status} />}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4">
                          <DiagramPreview
                            svg={result?.svg}
                            alt={`Animated diagram: ${concept.name}`}
                            busyMessage={job?.running ? currentStep : undefined}
                            onOpen={() => setOpenId(concept.id)}
                          />
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Button
                            variant="primary"
                            onClick={() => generate(concept)}
                            disabled={anyRunning}
                            title={anyRunning && !job?.running ? "One generation at a time, to respect the free API limits" : undefined}
                          >
                            {job?.running ? <Spinner width={15} height={15} /> : <SparkIcon width={15} height={15} />}
                            {job?.running ? "Generating…" : result ? "Regenerate live" : "Generate"}
                          </Button>
                          {isLive && !job?.running && (
                            <Button variant="ghost" onClick={() => revert(concept.id)} title="Go back to the result saved in results.json">
                              <UndoIcon width={15} height={15} /> Revert to saved
                            </Button>
                          )}
                          {isLive && !job?.running && !job?.error && (
                            <span className="text-xs text-subtle">Showing a live result, kept in this browser.</span>
                          )}
                        </div>
                        {job && (job.running || job.error || job.steps.length > 1) && <JobLog job={job} />}

                        <KeyIdea concept={concept} />
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
                          <div className="space-y-4">
                            <div>
                              <p className="text-lg font-bold tabular-nums">{formatUsd(result.costUsd)}</p>
                              <p className="text-xs leading-relaxed text-subtle">
                                {formatInt(result.usage.inputTokens)} tokens in
                                <br />
                                {formatInt(result.usage.outputTokens)} tokens out
                              </p>
                            </div>
                            <div>
                              <p className="text-base font-bold">
                                {result.retries.total} {result.retries.total === 1 ? "retry" : "retries"}
                              </p>
                              <p className="text-xs leading-relaxed text-subtle">
                                {result.retries.validation} after checks · {result.retries.api} API
                              </p>
                            </div>
                            <p className="font-mono text-[11px] text-subtle">{result.model}</p>
                          </div>
                        ) : (
                          <p className="text-sm text-subtle">–</p>
                        )}
                      </td>

                      {/* Review */}
                      <td className={cell} data-label="Teacher review">
                        <ReviewPanel
                          conceptName={concept.name}
                          review={review}
                          loaded={reviewsLoaded}
                          onChange={(patch) => updateReview(concept.id, patch)}
                        />
                      </td>
                    </Reveal>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <ChecksSection />
      </main>

      <Footer />

      {open?.result && <DiagramModal concept={open.concept} result={open.result} onClose={() => setOpenId(null)} />}
    </div>
  );
}

const NAV_LINKS = [
  { id: "how", label: "How it works" },
  { id: "diagrams", label: "Diagrams" },
  { id: "checks", label: "Checks" },
];

/** Floating nav: turns into frosted glass on scroll and highlights the section in view. */
function NavBar({ passing, total }: { passing: number; total: number }) {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 8);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
      // The active section is the last one whose top has passed 40% of the screen.
      const line = window.innerHeight * 0.4;
      let current: string | null = null;
      for (const { id } of NAV_LINKS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Slide the highlight pill under the active link.
  useEffect(() => {
    const place = () => {
      const link = active ? listRef.current?.querySelector<HTMLAnchorElement>(`a[href="#${active}"]`) : null;
      setPill(link ? { left: link.offsetLeft, width: link.offsetWidth } : null);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [active]);

  return (
    <div className="fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-4">
      <nav
        aria-label="Main"
        className={`relative mx-auto max-w-6xl rounded-2xl bg-surface/90 ring-1 ring-border backdrop-blur-xl transition-shadow duration-300 ${
          scrolled || menuOpen ? "shadow-card" : "shadow-subtle"
        }`}
      >
        <div className="flex h-14 items-center gap-3 pl-3 pr-2">
          <a href="#" className="group flex min-w-0 items-center gap-2.5" onClick={() => setMenuOpen(false)}>
            <span className="grid size-9 place-items-center rounded-xl bg-linear-to-br from-accent via-accent-3 to-accent-2 text-white shadow-subtle transition-transform duration-500 group-hover:rotate-180">
              <AtomIcon width={19} height={19} />
            </span>
            <span className="leading-none">
              <span className="block truncate text-[15px] font-extrabold tracking-tight">Science Diagram Maker</span>
              <span className="mt-1 block text-[11px] font-medium text-subtle">GCSE · AI · checked</span>
            </span>
          </a>

          {/* Desktop links */}
          <ul ref={listRef} className="relative mx-auto hidden items-center gap-1 rounded-xl bg-surface-2/70 p-1 ring-1 ring-inset ring-border md:flex">
            <span
              aria-hidden
              className="absolute bottom-1 top-1 rounded-lg bg-surface shadow-subtle ring-1 ring-border transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ left: pill?.left ?? 0, width: pill?.width ?? 0, opacity: pill ? 1 : 0 }}
            />
            {NAV_LINKS.map(({ id, label }) => (
              <li key={id} className="relative">
                <a
                  href={`#${id}`}
                  aria-current={active === id ? "location" : undefined}
                  className={`block rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors duration-300 ${
                    active === id ? "text-fg" : "text-muted hover:text-fg"
                  }`}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <span
              className="hidden items-center gap-1.5 rounded-full bg-pass-soft px-2.5 py-1 text-xs font-semibold text-pass lg:inline-flex"
              title="Diagrams passing every check"
            >
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-pass opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-pass" />
              </span>
              {passing}/{total} passing
            </span>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Source code on GitHub"
              title="Source code on GitHub"
              className="grid size-9 place-items-center rounded-xl text-muted ring-1 ring-inset ring-border transition hover:bg-surface-2 hover:text-fg"
            >
              <GithubIcon width={17} height={17} />
            </a>
            <a
              href="#diagrams"
              className="hidden items-center gap-1.5 rounded-xl bg-fg px-4 py-2 text-sm font-semibold text-bg transition hover:opacity-90 sm:inline-flex"
            >
              Review diagrams <ArrowRightIcon width={15} height={15} />
            </a>
            <button
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              className="grid size-9 place-items-center rounded-xl ring-1 ring-inset ring-border transition hover:bg-surface-2 md:hidden"
            >
              {menuOpen ? <XIcon width={18} height={18} /> : <MenuIcon width={18} height={18} />}
            </button>
          </div>
        </div>

        {/* Scroll progress */}
        <div className="pointer-events-none absolute inset-x-4 bottom-0 h-[2px] overflow-hidden rounded-full" aria-hidden>
          <div
            className="h-full origin-left bg-linear-to-r from-accent via-accent-2 to-accent-3 transition-transform duration-150 ease-out"
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <ul className="animate-fade-up space-y-1 border-t border-border p-2 md:hidden">
            {NAV_LINKS.map(({ id, label }) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  onClick={() => setMenuOpen(false)}
                  className={`block rounded-xl px-3 py-2.5 text-[15px] font-medium ${
                    active === id ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg"
                  }`}
                >
                  {label}
                </a>
              </li>
            ))}
            <li className="px-3 py-2 text-sm font-semibold text-pass">
              {passing}/{total} diagrams passing every check
            </li>
          </ul>
        )}
      </nav>
    </div>
  );
}

/** The best saved diagram, shown big in the hero like a product screenshot. */
function HeroPreview({
  row,
  onOpen,
}: {
  row: { concept: Concept; result?: DiagramResult } | undefined;
  onOpen: (id: number) => void;
}) {
  return (
    <div className="animate-float relative">
      <div className="absolute -inset-6 -z-10 rounded-[40px] bg-accent/20 blur-3xl" aria-hidden />
      <Tilt className="gradient-ring shadow-card">
        <div className="overflow-hidden rounded-[23px] bg-surface">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
            <span className="ml-3 truncate text-xs text-subtle">
              {row ? `${row.concept.subject} · ${row.concept.name}` : "Diagram preview"}
            </span>
            {row?.result && (
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-pass-soft px-2 py-0.5 text-[11px] font-semibold text-pass">
                <span className="size-1.5 animate-pulse rounded-full bg-pass" /> Live SVG
              </span>
            )}
          </div>
          {row?.result ? (
            <button
              type="button"
              onClick={() => onOpen(row.concept.id)}
              className="group/img block w-full cursor-zoom-in overflow-hidden bg-paper p-3"
              aria-label={`Open details for ${row.concept.name}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={svgDataUri(row.result.svg)} alt={`Animated diagram: ${row.concept.name}`} className="aspect-8/5 w-full object-contain transition-transform duration-700 ease-out group-hover/img:scale-[1.04]" />
            </button>
          ) : (
            <div className="grid aspect-8/5 place-items-center bg-surface-2 text-sm text-subtle">No diagram generated yet</div>
          )}
          {row?.result && (
            <div className="flex flex-wrap gap-1.5 border-t border-border px-4 py-3">
              {row.result.checks.map((c) => (
                <span
                  key={c.id}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    c.passed ? "bg-pass-soft text-pass" : "bg-fail-soft text-fail"
                  }`}
                >
                  {c.passed ? <CheckIcon width={11} height={11} strokeWidth={3} /> : <XIcon width={11} height={11} strokeWidth={3} />}
                  {c.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </Tilt>
    </div>
  );
}

function SectionHeading({ eyebrow, title, text, center }: { eyebrow: string; title: string; text: string; center?: boolean }) {
  return (
    <Reveal className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <p className="text-sm font-semibold uppercase tracking-wider text-accent">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-extrabold sm:text-4xl">{title}</h2>
      <p className="mt-3 text-lg leading-relaxed text-muted">{text}</p>
    </Reveal>
  );
}

function HowItWorks() {
  const steps = [
    { Icon: PencilIcon, title: "AI draws", text: "Gemini turns each GCSE idea into an animated SVG diagram." },
    { Icon: ShieldCheckIcon, title: "Code checks", text: "Six automatic checks. If one fails, the AI gets one more try with the exact reasons." },
    { Icon: TeacherIcon, title: "Teacher decides", text: "A person approves or rejects each diagram and leaves a note." },
  ];
  return (
    <section id="how" className="mx-auto max-w-7xl px-4 pt-20 sm:px-6 lg:px-8">
      <SectionHeading
        center
        eyebrow="How it works"
        title="From idea to classroom in three steps"
        text="AI output is fast but sometimes wrong. Every diagram passes through code and a person before anyone learns from it."
      />
      <ol className="relative mt-12 grid gap-4 md:grid-cols-3">
        <div className="absolute left-[16%] right-[16%] top-8 hidden h-px bg-linear-to-r from-accent/0 via-border-strong to-accent/0 md:block" aria-hidden />
        {steps.map(({ Icon, title, text }, i) => (
          <Reveal
            as="li"
            key={title}
            delay={i * 120}
            className="group relative rounded-3xl bg-surface p-6 text-center shadow-subtle ring-1 ring-inset ring-border hover:-translate-y-1.5 hover:shadow-card hover:ring-accent/40"
          >
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-linear-to-br from-accent to-accent-3 text-white shadow-card transition-transform duration-500 ease-out group-hover:-rotate-6 group-hover:scale-110">
              <Icon width={24} height={24} />
            </span>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-subtle">Step {i + 1}</p>
            <p className="mt-1 text-lg font-bold">{title}</p>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">{text}</p>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}

const CHECK_ICONS: Record<CheckId, typeof CodeIcon> = {
  valid: CodeIcon,
  inViewBox: FrameIcon,
  labels: TagIcon,
  animated: PlayIcon,
  keyTerms: BookIcon,
  safe: ShieldCheckIcon,
};

function ChecksSection() {
  return (
    <section id="checks" className="border-t border-border bg-surface/50">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <SectionHeading
          center
          eyebrow="Quality checks"
          title="Six checks. No guesswork."
          text="Every diagram is checked in code before it is accepted. If a check fails, the model is asked again once with the exact reasons. API errors 429 and 503 are retried up to 3 times."
        />
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CHECK_ORDER.map((id, i) => {
            const Icon = CHECK_ICONS[id];
            const extra = OWN_CHECKS.includes(id);
            return (
              <Reveal
                as="li"
                key={id}
                delay={(i % 3) * 100}
                className="group rounded-3xl bg-surface p-6 shadow-subtle ring-1 ring-inset ring-border hover:-translate-y-1.5 hover:shadow-card hover:ring-accent/40"
              >
                <div className="flex items-center justify-between">
                  <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent transition-all duration-500 ease-out group-hover:scale-110 group-hover:bg-accent group-hover:text-accent-fg">
                    <Icon width={20} height={20} />
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      extra ? "bg-accent-soft text-accent" : "bg-surface-2 text-subtle ring-1 ring-inset ring-border"
                    }`}
                  >
                    {extra ? "Our extra check" : "Required"}
                  </span>
                </div>
                <p className="mt-4 text-lg font-bold">{CHECK_LABELS[id]}</p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{CHECK_DESCRIPTIONS[id]}</p>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 text-sm text-subtle sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-linear-to-br from-accent via-accent-3 to-accent-2 text-white">
            <AtomIcon width={15} height={15} />
          </span>
          <span className="font-semibold text-fg">Science Diagram Maker</span>
        </div>
        <div className="space-y-1 md:text-right">
          <p>Reviews and live results are stored in this browser (localStorage). Diagrams render inside &lt;img&gt;, so no script in them can run.</p>
          <p>Costs are estimates at paid-tier prices. The free tier costs $0.</p>
        </div>
      </div>
    </footer>
  );
}

/** The idea from the brief, with the key terms a student should spot in the diagram. */
function KeyIdea({ concept }: { concept: Concept }) {
  return (
    <div className="mt-4 rounded-2xl bg-warn-soft p-4 ring-1 ring-inset ring-warn/20">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-warn">
        <LightbulbIcon width={16} height={16} /> Key idea
      </p>
      <p className="mt-1 text-[15px] leading-relaxed">{concept.text}</p>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Key terms">
        {concept.keyTerms.map((t) => (
          <li key={t.name} className="rounded-full bg-surface px-2.5 py-0.5 text-[13px] font-medium ring-1 ring-inset ring-border">
            {t.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Metric({
  label,
  value,
  delay = 0,
  children,
}: {
  label: string;
  value: React.ReactNode;
  delay?: number;
  children?: React.ReactNode;
}) {
  return (
    <Reveal delay={delay} className="px-2 py-8 lg:px-8 lg:first:pl-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-4xl font-extrabold tabular-nums tracking-tight">{value}</dd>
      {children && <dd className="mt-2 text-xs text-subtle">{children}</dd>}
    </Reveal>
  );
}

/** One bar per diagram; the passing ones fill in one after another when scrolled into view. */
function Meter({ value, max }: { value: number; max: number }) {
  const [ref, state] = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="flex gap-1" aria-hidden>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-border-strong">
          <span
            className="absolute inset-0 origin-left rounded-full bg-pass transition-transform duration-700 ease-out"
            style={{ transform: `scaleX(${state !== "hidden" && i < value ? 1 : 0})`, transitionDelay: `${300 + i * 140}ms` }}
          />
        </span>
      ))}
    </div>
  );
}

function JobLog({ job }: { job: Job }) {
  return (
    <div className="mt-3 rounded-xl bg-surface-2 p-3 ring-1 ring-inset ring-border" aria-live="polite">
      {job.error && (
        <div role="alert" className="mb-2 flex gap-2 rounded-lg bg-fail-soft p-2.5 text-sm text-fail">
          <AlertIcon width={16} height={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Generation failed</p>
            <p className="leading-relaxed">{job.error}</p>
          </div>
        </div>
      )}
      <ol className="space-y-1">
        {job.steps.slice(1).map((s, i) => (
          <li key={i} className="animate-fade-up flex gap-1.5 text-[13px] leading-snug text-muted">
            {s.tone === "pass" ? (
              <CheckIcon width={14} height={14} className="mt-px shrink-0 text-pass" />
            ) : s.tone === "fail" ? (
              <XIcon width={14} height={14} className="mt-px shrink-0 text-fail" />
            ) : (
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-subtle" />
            )}
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
