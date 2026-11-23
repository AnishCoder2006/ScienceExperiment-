"use client";

// Small motion helpers: scroll reveal, count-up numbers and a mouse tilt.
// They are fail-safe: content is fully visible in the server HTML and stays visible
// if it is already on screen when the page loads. Only content that starts below the
// fold is hidden, and it animates in when scrolled to. "Reduce motion" turns it all off.

import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * "static": shown as is (server render, already on screen at load, or reduced motion).
 * "hidden": below the fold, waiting to be scrolled to.
 * "shown":  scrolled into view, animating in.
 */
export type RevealState = "static" | "hidden" | "shown";

export function useReveal<T extends Element>() {
  const ref = useRef<T>(null);
  const [state, setState] = useState<RevealState>("static");

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || prefersReducedMotion()) return;
    // Already on screen when the page loads: never hide it.
    if (el.getBoundingClientRect().top < window.innerHeight) return;

    setState("hidden");
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setState("shown");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return [ref, state] as const;
}

/** Fades and lifts its content in when it scrolls into view. `delay` staggers siblings. */
export function Reveal({
  as = "div",
  delay = 0,
  className = "",
  style,
  children,
  ...rest
}: {
  as?: "div" | "li" | "tr" | "section";
  delay?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
} & Record<string, unknown>) {
  const [ref, state] = useReveal<HTMLElement>();
  const Tag = as as ElementType;
  const motion = state === "hidden" ? "reveal" : state === "shown" ? "reveal is-visible" : "";
  return (
    <Tag
      ref={ref}
      className={`${motion} ${className}`}
      style={{ ...style, "--reveal-delay": `${delay}ms` } as CSSProperties}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Shows `value`. If it starts below the fold, it counts up from 0 when scrolled to; later changes count smoothly. */
export function CountUp({ value, format, duration = 1200 }: { value: number; format: (n: number) => string; duration?: number }) {
  const [ref, state] = useReveal<HTMLSpanElement>();
  const [shown, setShown] = useState(value);
  const current = useRef(value);

  useEffect(() => {
    if (state === "hidden") {
      current.current = 0;
      setShown(0);
      return;
    }
    const from = current.current;
    if (from === value || prefersReducedMotion()) {
      current.current = value;
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const next = from + (value - from) * (1 - Math.pow(1 - p, 3));
      current.current = next;
      setShown(next);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state, value, duration]);

  return (
    <span ref={ref} className="tabular-nums">
      {format(shown)}
    </span>
  );
}

/** Tilts toward the mouse in 3D and moves a soft glare with it. Mouse only. */
export function Tilt({ children, className = "", max = 7 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse" || prefersReducedMotion()) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(1100px) rotateX(${(-y * max).toFixed(2)}deg) rotateY(${(x * max).toFixed(2)}deg)`;
    el.style.setProperty("--mx", `${((x + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${((y + 0.5) * 100).toFixed(1)}%`);
  };
  const onLeave = () => {
    if (ref.current) ref.current.style.transform = "";
  };

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={`tilt group/tilt relative transition-transform duration-300 ease-out ${className}`}
    >
      {children}
      <div className="tilt-glare pointer-events-none absolute inset-0 rounded-[24px] opacity-0 transition-opacity duration-300 group-hover/tilt:opacity-100" aria-hidden />
    </div>
  );
}
