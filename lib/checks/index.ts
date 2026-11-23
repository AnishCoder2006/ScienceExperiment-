import { DOMParser, type Element } from "@xmldom/xmldom";
import type { CheckId, CheckResult, Concept } from "../types";
import { checkBounds } from "./bounds";
import type { Box } from "./geometry";
import { StyleSheet } from "./styles";

export const CHECK_LABELS: Record<CheckId, string> = {
  valid: "Valid SVG",
  inViewBox: "Inside viewBox",
  labels: "Title + 3 labels",
  animated: "Animated",
  keyTerms: "Key terms labelled",
  safe: "Safe to embed",
};

export const CHECK_ORDER: CheckId[] = ["valid", "inViewBox", "labels", "animated", "keyTerms", "safe"];

const SVG_NS = "http://www.w3.org/2000/svg";

const pass = (id: CheckId, detail: string): CheckResult => ({ id, label: CHECK_LABELS[id], passed: true, detail });
const fail = (id: CheckId, detail: string): CheckResult => ({ id, label: CHECK_LABELS[id], passed: false, detail });

/** Pull the <svg>…</svg> out of a model reply that may contain ```xml fences or chatter. */
export function extractSvg(raw: string): string | null {
  const start = raw.search(/<svg[\s>]/i);
  const end = raw.toLowerCase().lastIndexOf("</svg>");
  if (start === -1 || end === -1 || end < start) return null;
  return raw.slice(start, end + "</svg>".length);
}

function allElements(root: Element): Element[] {
  const out: Element[] = [];
  const visit = (el: Element) => {
    out.push(el);
    for (const n of Array.from(el.childNodes)) if (n.nodeType === 1) visit(n as unknown as Element);
  };
  visit(root);
  return out;
}

const textOf = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

interface Parsed {
  root: Element;
  viewBox: Box;
  elements: Element[];
}

// ---------------------------------------------------------------------------
// Check 1: the SVG is valid and can be parsed
// ---------------------------------------------------------------------------
function checkValid(svg: string | null): { result: CheckResult; parsed?: Parsed } {
  if (!svg) return { result: fail("valid", "No <svg>…</svg> element found in the response.") };

  const errors: string[] = [];
  const parser = new DOMParser({
    onError: (level, msg) => {
      // Browsers refuse to draw an SVG with any XML error, so warnings count too.
      errors.push(`${level}: ${msg.replace(/^\[xmldom [^\]]*\]\s*/, "").split("\n")[0]}`);
    },
  });

  let doc;
  try {
    doc = parser.parseFromString(svg, "text/xml");
  } catch (e) {
    errors.push(e instanceof Error ? e.message.split("\n")[0] : String(e));
  }
  if (errors.length || !doc?.documentElement) {
    return { result: fail("valid", `XML parse error: ${errors.slice(0, 2).join("; ") || "empty document"}.`) };
  }

  const root = doc.documentElement as unknown as Element;
  if (root.localName !== "svg") {
    return { result: fail("valid", `The root element is <${root.localName}>, expected <svg>.`) };
  }
  if (root.getAttribute("xmlns") !== SVG_NS) {
    // Without the namespace, browsers will not render the file as an image.
    return { result: fail("valid", `The <svg> element needs xmlns="${SVG_NS}".`) };
  }
  const vb = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) {
    return { result: fail("valid", `viewBox must be 4 numbers with positive width and height, got "${root.getAttribute("viewBox") ?? ""}".`) };
  }

  const viewBox = { minX: vb[0], minY: vb[1], maxX: vb[0] + vb[2], maxY: vb[1] + vb[3] };
  return {
    result: pass("valid", `Parsed without errors. viewBox is ${vb.join(" ")}.`),
    parsed: { root, viewBox, elements: allElements(root) },
  };
}

// ---------------------------------------------------------------------------
// Check 2: nothing is drawn outside the viewBox
// ---------------------------------------------------------------------------
function checkInViewBox({ root, viewBox }: Parsed, styles: StyleSheet): CheckResult {
  const { drawnElements, overflows } = checkBounds(root, viewBox, styles);
  const vb = `${viewBox.minX} ${viewBox.minY} ${viewBox.maxX - viewBox.minX} ${viewBox.maxY - viewBox.minY}`;
  if (overflows.length === 0) {
    return pass("inViewBox", `All ${drawnElements} drawn elements stay inside the viewBox (${vb}), including animated positions.`);
  }
  const list = overflows
    .slice(0, 6)
    .map((o) => `${o.element}: ${o.edges.join(", ")}`)
    .join("; ");
  const more = overflows.length > 6 ? ` (and ${overflows.length - 6} more)` : "";
  return fail("inViewBox", `${overflows.length} element(s) go outside the viewBox (${vb}): ${list}${more}.`);
}

// ---------------------------------------------------------------------------
// Check 3: it has a title and at least 3 text labels
// ---------------------------------------------------------------------------
function checkLabels({ root, elements }: Parsed): CheckResult {
  const title = Array.from(root.childNodes).find(
    (n) => n.nodeType === 1 && (n as unknown as Element).localName === "title",
  ) as unknown as Element | undefined;
  const labels = elements.filter((el) => el.localName === "text" && textOf(el));
  const problems: string[] = [];
  if (!title || !textOf(title)) problems.push("no non-empty <title> as a direct child of <svg>");
  if (labels.length < 3) problems.push(`only ${labels.length} non-empty <text> label(s), need at least 3`);
  if (problems.length) return fail("labels", `Missing: ${problems.join(" and ")}.`);
  return pass("labels", `Title "${textOf(title!)}" and ${labels.length} text labels.`);
}

// ---------------------------------------------------------------------------
// Check 4: it has at least one animation
// ---------------------------------------------------------------------------

/** SMIL durations: "2s", "500ms", "1.5", "0:00:02". Returns seconds. */
export function durationSeconds(dur: string | null): number {
  if (!dur) return 0;
  const v = dur.trim();
  if (v.includes(":")) return v.split(":").reduce((acc, part) => acc * 60 + (parseFloat(part) || 0), 0);
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0; // includes "indefinite"
  if (v.endsWith("ms")) return n / 1000;
  if (v.endsWith("min")) return n * 60;
  if (v.endsWith("h")) return n * 3600;
  return n;
}

function checkAnimated({ elements }: Parsed, css: string): CheckResult {
  const smil = elements.filter((el) => ["animate", "animateTransform", "animateMotion", "set"].includes(el.localName ?? ""));
  const running = smil.filter((el) => el.localName === "set" || durationSeconds(el.getAttribute("dur")) > 0);

  const keyframes = [...css.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  const usedKeyframes = keyframes.filter((name) =>
    new RegExp(`animation(?:-name)?\\s*:[^;}]*\\b${name.replace(/[-]/g, "\\-")}\\b`).test(css),
  );

  if (running.length || usedKeyframes.length) {
    const parts: string[] = [];
    if (running.length) {
      const kinds = [...new Set(running.map((el) => el.localName))].join(", ");
      parts.push(`${running.length} SMIL animation(s) (${kinds})`);
    }
    if (usedKeyframes.length) parts.push(`CSS @keyframes ${usedKeyframes.join(", ")}`);
    return pass("animated", `Found ${parts.join(" and ")}.`);
  }
  if (smil.length) return fail("animated", `Found ${smil.length} SMIL element(s) but none has a dur greater than 0, so nothing moves.`);
  if (keyframes.length) return fail("animated", `@keyframes ${keyframes.join(", ")} defined but no element uses it in an animation property.`);
  return fail("animated", "No animation found. Add <animate>, <animateTransform> or <animateMotion> with a dur.");
}

// ---------------------------------------------------------------------------
// Check 5 (our own): the GCSE key terms for this concept are labelled
// ---------------------------------------------------------------------------

/** Lower-case and turn ² ₂ ^2 style characters into plain digits so patterns stay simple. */
export function normaliseLabelText(text: string): string {
  const map: Record<string, string> = { "²": "2", "₂": "2", "³": "3", "₃": "3", "⁶": "6", "₆": "6", "−": "-" };
  return text.toLowerCase().replace(/[²₂³₃⁶₆−]/g, (c) => map[c]).replace(/\s+/g, " ");
}

function checkKeyTerms({ elements }: Parsed, concept: Concept): CheckResult {
  const labels = normaliseLabelText(
    elements.filter((el) => el.localName === "text").map(textOf).join(" | "),
  );
  const missing = concept.keyTerms.filter((term) => !term.pattern.test(labels)).map((t) => t.name);
  if (missing.length) {
    return fail("keyTerms", `These GCSE terms are not written in any text label: ${missing.join(", ")}.`);
  }
  return pass("keyTerms", `All ${concept.keyTerms.length} key terms are labelled: ${concept.keyTerms.map((t) => t.name).join(", ")}.`);
}

// ---------------------------------------------------------------------------
// Check 6 (our own): safe to embed in a web page
// ---------------------------------------------------------------------------
function checkSafe({ elements }: Parsed, css: string): CheckResult {
  const problems = new Set<string>();
  for (const el of elements) {
    if (["script", "foreignObject", "iframe", "embed", "object"].includes(el.localName ?? "")) {
      problems.add(`<${el.localName}> element`);
    }
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) problems.add(`${attr.name} event handler`);
      if (/(^|:)href$/.test(attr.name) && !/^(#|data:image\/)/i.test(attr.value.trim())) {
        problems.add(`external link ${attr.name}="${attr.value.slice(0, 40)}"`);
      }
    }
  }
  if (/@import|url\(\s*['"]?(?!#|data:image\/)/i.test(css)) problems.add("external url() or @import in CSS");
  if (problems.size) return fail("safe", `Remove: ${[...problems].slice(0, 5).join(", ")}. The SVG must be self-contained.`);
  return pass("safe", "No scripts, event handlers or external resources.");
}

// ---------------------------------------------------------------------------

export interface CheckRun {
  /** The cleaned SVG (just the <svg> element), or null if none was found. */
  svg: string | null;
  checks: CheckResult[];
}

/** Run every check on a model reply. Checks 2-6 are skipped if the SVG cannot be parsed. */
export function runChecks(raw: string, concept: Concept): CheckRun {
  const svg = extractSvg(raw);
  const { result: valid, parsed } = checkValid(svg);
  if (!parsed) {
    const skipped = CHECK_ORDER.slice(1).map((id) => fail(id, "Not checked because the SVG could not be parsed."));
    return { svg, checks: [valid, ...skipped] };
  }

  const styleText = parsed.elements.filter((el) => el.localName === "style").map((el) => el.textContent ?? "").join("\n");
  const inlineStyles = parsed.elements.map((el) => el.getAttribute("style") ?? "").filter(Boolean).join(";\n");
  const css = `${styleText}\n${inlineStyles}`;
  const styles = new StyleSheet(styleText);

  return {
    svg,
    checks: [
      valid,
      checkInViewBox(parsed, styles),
      checkLabels(parsed),
      checkAnimated(parsed, css),
      checkKeyTerms(parsed, concept),
      checkSafe(parsed, css),
    ],
  };
}
