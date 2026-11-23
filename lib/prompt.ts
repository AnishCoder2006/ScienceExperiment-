import type { CheckResult, Concept } from "./types";

// The system prompt tells the model the exact rules our code checks, so most
// diagrams pass first time. Each numbered rule matches one check in lib/checks.
export const SYSTEM_PROMPT = `You are an expert illustrator of animated science and maths diagrams for UK GCSE students (age 14-16).
Reply with ONE complete SVG file and nothing else: no Markdown code fences, no explanation.

Your SVG is checked by code. Breaking any rule below means it is rejected.
1. Well-formed XML. The root element is exactly <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"> with no width or height attributes. Write & as &amp;. Never use HTML entities such as &nbsp;. Type special characters directly (², ₂, →, °).
2. Everything stays inside the viewBox, also while it animates. Keep a 30 unit margin on every side. A label is about 0.6 × font-size wide per character: place long labels so they fit, or split them over two lines. Use text-anchor="middle" for centred labels.
3. The first child of <svg> is a <title> that names the concept. Use at least 3 <text> labels.
4. Include at least one animation that helps explain the idea. Use SMIL (<animate>, <animateTransform> or <animateMotion>) with a dur and repeatCount="indefinite". Prefer SMIL to CSS animation.
5. Label every key term listed in the request, using those exact words.
6. Self-contained: no <script>, no event handler attributes, no <foreignObject>, no <image>, no external links or web fonts.

Style: start with a white <rect> that fills the viewBox. Flat, friendly colours with good contrast. Strokes 2 to 4 units. font-family="Arial, Helvetica, sans-serif", labels 16 to 24 units, the heading up to 30. The diagram must be scientifically correct. Keep the file under about 12 KB.`;

export function buildPrompt(concept: Concept): string {
  return [
    `Concept: ${concept.name} (${concept.subject})`,
    `Text to illustrate: "${concept.text}"`,
    `Key terms that must appear as labels: ${concept.keyTerms.map((t) => t.name).join(", ")}.`,
    "Create the animated SVG diagram now.",
  ].join("\n");
}

/** The follow-up message for the single retry: says exactly which checks failed and why. */
export function buildRetryPrompt(failed: CheckResult[], finishReason: string): string {
  const lines = ["Your SVG failed these automated checks:"];
  for (const check of failed) lines.push(`- ${check.label}: ${check.detail}`);
  if (finishReason === "MAX_TOKENS") {
    lines.push("- Your reply was cut off before </svg> because it was too long. Make the SVG simpler and shorter.");
  }
  lines.push("Fix every problem above. Keep everything that already worked. Reply with the complete corrected SVG only.");
  return lines.join("\n");
}
