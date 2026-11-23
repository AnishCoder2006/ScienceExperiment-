import type { CheckId } from "./types";

// Names and plain-English descriptions of the checks. Kept separate from lib/checks
// so the browser can import it without bundling the XML parser.

export const CHECK_ORDER: CheckId[] = ["valid", "inViewBox", "labels", "animated", "keyTerms", "safe"];

export const CHECK_LABELS: Record<CheckId, string> = {
  valid: "Valid SVG",
  inViewBox: "Inside viewBox",
  labels: "Title + 3 labels",
  animated: "Animated",
  keyTerms: "Key terms labelled",
  safe: "Safe to embed",
};

export const CHECK_DESCRIPTIONS: Record<CheckId, string> = {
  valid: "Parses as strict XML, the root is <svg> with the SVG namespace and a 4-number viewBox.",
  inViewBox:
    "Every shape and label, after transforms and SMIL animation, stays inside the viewBox. Text width is estimated from font size.",
  labels: "A non-empty <title> and at least 3 non-empty <text> labels.",
  animated: "At least one SMIL animation with a duration, or CSS @keyframes that an element actually uses.",
  keyTerms: "Our check: the labels include the GCSE terms for the concept, e.g. hypotenuse or chlorophyll.",
  safe: "Our check: no scripts, event handlers, foreignObject or external links, so it is safe to embed.",
};

/** Which checks the assignment requires, and which we added. */
export const OWN_CHECKS: CheckId[] = ["keyTerms", "safe"];
