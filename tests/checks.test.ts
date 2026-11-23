import { describe, expect, it } from "vitest";
import { CONCEPTS } from "../lib/concepts";
import { durationSeconds, extractSvg, runChecks } from "../lib/checks";
import { pathPoints, boxFromPoints } from "../lib/checks/geometry";
import type { CheckId } from "../lib/types";

const pythagoras = CONCEPTS[0];

/** Wrap body elements in a valid SVG with a title. */
const svg = (body: string, { title = "Pythagoras' theorem", viewBox = "0 0 800 500" } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">` +
  (title ? `<title>${title}</title>` : "") +
  body +
  `</svg>`;

/** A diagram that should pass every check. */
const GOOD_BODY = `
  <style>.label { font-size: 20px; font-family: sans-serif; }</style>
  <polygon points="200,400 600,400 200,100" fill="none" stroke="#333" stroke-width="3"/>
  <text class="label" x="400" y="440" text-anchor="middle">a</text>
  <text class="label" x="170" y="250" text-anchor="middle">b</text>
  <text class="label" x="420" y="230">c (hypotenuse)</text>
  <text class="label" x="400" y="480" text-anchor="middle">a<tspan baseline-shift="super">2</tspan> + b² = c²</text>
  <circle cx="200" cy="400" r="6" fill="red">
    <animate attributeName="r" values="6;12;6" dur="2s" repeatCount="indefinite"/>
  </circle>`;

const LABELS = `<text x="100" y="100">hypotenuse</text><text x="100" y="150">a² + b² = c²</text><text x="100" y="200">b</text>`;
const ANIM = `<circle cx="50" cy="50" r="5"><animate attributeName="opacity" values="0;1" dur="1s"/></circle>`;

function check(raw: string, id: CheckId) {
  const result = runChecks(raw, pythagoras).checks.find((c) => c.id === id)!;
  return result;
}

describe("good diagram", () => {
  it("passes every check", () => {
    const { checks } = runChecks(svg(GOOD_BODY), pythagoras);
    for (const c of checks) expect(c.passed, `${c.id}: ${c.detail}`).toBe(true);
  });

  it("finds the SVG inside a fenced reply with extra text", () => {
    const reply = "Here is your diagram:\n```xml\n" + svg(GOOD_BODY) + "\n```\nHope it helps!";
    expect(extractSvg(reply)?.startsWith("<svg")).toBe(true);
    expect(runChecks(reply, pythagoras).checks.every((c) => c.passed)).toBe(true);
  });
});

describe("check 1: valid SVG", () => {
  it("fails when there is no svg at all", () => {
    expect(check("Sorry, I cannot draw that.", "valid").detail).toMatch(/No <svg>/);
  });

  it("fails on broken XML and skips the other checks", () => {
    const { checks } = runChecks(svg("<g><rect x='1' y='1' width='5' height='5'></g>"), pythagoras);
    expect(checks[0].passed).toBe(false);
    expect(checks[0].detail).toMatch(/XML parse error/);
    expect(checks.slice(1).every((c) => !c.passed && /Not checked/.test(c.detail))).toBe(true);
  });

  it("fails on HTML entities that XML does not know", () => {
    expect(check(svg("<text x='10' y='10'>a&nbsp;b</text>"), "valid").passed).toBe(false);
  });

  it("fails without the SVG namespace", () => {
    const raw = `<svg viewBox="0 0 10 10"><title>t</title></svg>`;
    expect(check(raw, "valid").detail).toMatch(/xmlns/);
  });

  it("fails without a usable viewBox", () => {
    expect(check(svg("", { viewBox: "0 0 0 100" }), "valid").detail).toMatch(/viewBox/);
  });
});

describe("check 2: inside viewBox", () => {
  it("catches a label that runs off the right edge", () => {
    const result = check(svg(`<text x="760" y="50" font-size="24">Hypotenuse</text>`), "inViewBox");
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/<text> "Hypotenuse": right edge/);
  });

  it("respects text-anchor end", () => {
    expect(check(svg(`<text x="790" y="50" font-size="24" text-anchor="end">Hypotenuse</text>`), "inViewBox").passed).toBe(true);
  });

  it("reads font-size from a CSS class", () => {
    const body = `<style>.big { font-size: 80px }</style><text class="big" x="500" y="100">Hypotenuse</text>`;
    expect(check(svg(body), "inViewBox").passed).toBe(false);
  });

  it("applies group transforms", () => {
    expect(check(svg(`<g transform="translate(700 0)"><rect x="50" y="10" width="100" height="20"/></g>`), "inViewBox").passed).toBe(false);
    expect(check(svg(`<g transform="scale(0.5)"><rect x="1000" y="10" width="100" height="20"/></g>`), "inViewBox").passed).toBe(true);
  });

  it("catches a Bezier curve that bulges outside", () => {
    expect(check(svg(`<path d="M 750 100 C 900 100 900 200 750 200" fill="none"/>`), "inViewBox").passed).toBe(false);
  });

  it("catches an animation that moves a shape outside", () => {
    const body = `<circle cx="100" cy="100" r="10"><animateTransform attributeName="transform" type="translate" values="0 0; 900 0" dur="2s"/></circle>`;
    expect(check(svg(body), "inViewBox").detail).toMatch(/right edge/);
  });

  it("catches <animate> on cx that moves a shape outside", () => {
    const body = `<circle cx="100" cy="100" r="10"><animate attributeName="cy" values="100;600" dur="2s"/></circle>`;
    expect(check(svg(body), "inViewBox").detail).toMatch(/bottom edge/);
  });

  it("follows animateMotion paths", () => {
    const body = `<circle cx="0" cy="0" r="5"><animateMotion path="M 100 100 L 100 -50" dur="2s"/></circle>`;
    expect(check(svg(body), "inViewBox").detail).toMatch(/top edge/);
  });

  it("ignores a base position that a never-ending animation replaces from the first frame", () => {
    // No cx means cx=0, but the dot moves from x=200 at once and forever, so x=0 is never on screen.
    const moving = `<circle r="6" cy="100"><animate attributeName="cx" values="200;600;200" dur="4s" repeatCount="indefinite"/></circle>`;
    expect(check(svg(moving), "inViewBox").passed).toBe(true);
    const motion = `<circle cx="0" cy="0" r="6"><animateMotion path="M 200 120 H 600" dur="2s" repeatCount="indefinite"/></circle>`;
    expect(check(svg(motion), "inViewBox").passed).toBe(true);
  });

  it("still counts the base position when the animation starts late", () => {
    // begin="1s": for the first second the dot sits at (0, 0), half outside the picture.
    const late = `<circle cx="0" cy="0" r="6"><animateMotion path="M 200 120 H 600" begin="1s" dur="2s" repeatCount="indefinite"/></circle>`;
    expect(check(svg(late), "inViewBox").detail).toMatch(/left edge at x=-6/);
    const once = `<circle r="6" cy="100"><animate attributeName="cx" values="200;600" dur="4s"/></circle>`;
    expect(check(svg(once), "inViewBox").passed).toBe(false);
  });

  it("allows a rotation that stays inside", () => {
    const body = `<g><rect x="380" y="230" width="40" height="40"/><animateTransform attributeName="transform" type="rotate" from="0 400 250" to="360 400 250" dur="4s"/></g>`;
    expect(check(svg(body), "inViewBox").passed).toBe(true);
  });

  it("ignores things inside <defs> but measures them when used", () => {
    const defs = `<defs><circle id="dot" cx="0" cy="0" r="10"/></defs>`;
    expect(check(svg(defs), "inViewBox").passed).toBe(true);
    expect(check(svg(defs + `<use href="#dot" x="900" y="10"/>`), "inViewBox").passed).toBe(false);
  });
});

describe("check 3: title and labels", () => {
  it("needs a title", () => {
    expect(check(svg(LABELS, { title: "" }), "labels").detail).toMatch(/<title>/);
  });

  it("needs at least 3 non-empty labels", () => {
    const body = `<text x="10" y="20">one</text><text x="10" y="40">two</text><text x="10" y="60">  </text>`;
    expect(check(svg(body), "labels").detail).toMatch(/only 2/);
    expect(check(svg(LABELS), "labels").passed).toBe(true);
  });
});

describe("check 4: animation", () => {
  it("fails with no animation", () => {
    expect(check(svg(LABELS), "animated").passed).toBe(false);
  });

  it("fails when SMIL has no duration", () => {
    const body = `<circle cx="5" cy="5" r="2"><animate attributeName="r" values="2;4"/></circle>`;
    expect(check(svg(body), "animated").detail).toMatch(/none has a dur/);
  });

  it("passes with SMIL", () => {
    expect(check(svg(ANIM), "animated").passed).toBe(true);
  });

  it("passes with used CSS keyframes and fails with unused ones", () => {
    const used = `<style>@keyframes pulse { from { opacity: 0 } to { opacity: 1 } } .p { animation: pulse 2s infinite; }</style>`;
    const unused = `<style>@keyframes pulse { from { opacity: 0 } to { opacity: 1 } }</style>`;
    expect(check(svg(used), "animated").passed).toBe(true);
    expect(check(svg(unused), "animated").detail).toMatch(/no element uses it/);
  });

  it("parses SMIL durations", () => {
    expect(durationSeconds("2s")).toBe(2);
    expect(durationSeconds("500ms")).toBe(0.5);
    expect(durationSeconds("0:00:03")).toBe(3);
    expect(durationSeconds("indefinite")).toBe(0);
  });
});

describe("check 5: key terms (own check)", () => {
  it("lists the missing terms", () => {
    const body = `<text x="10" y="20">a</text><text x="10" y="40">b</text><text x="10" y="60">c</text>`;
    const result = check(svg(body), "keyTerms");
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/hypotenuse/);
    expect(result.detail).toMatch(/a² \+ b² = c²/);
  });

  it("accepts the reversed equation and ^2 notation", () => {
    const body = `<text x="10" y="20">Hypotenuse</text><text x="10" y="40">c^2 = a^2 + b^2</text>`;
    expect(check(svg(body), "keyTerms").passed).toBe(true);
  });

  it("normalises subscripts for chemistry terms", () => {
    const photosynthesis = CONCEPTS[3];
    const body = ["CO₂", "H₂O", "Light energy", "Chlorophyll", "Glucose", "O₂"]
      .map((t, i) => `<text x="10" y="${30 + i * 30}">${t}</text>`)
      .join("");
    expect(runChecks(svg(body), photosynthesis).checks.find((c) => c.id === "keyTerms")!.passed).toBe(true);
  });
});

describe("check 6: safe to embed (own check)", () => {
  it("rejects scripts, event handlers and external links", () => {
    expect(check(svg(`<script>alert(1)</script>`), "safe").passed).toBe(false);
    expect(check(svg(`<rect onclick="x()" width="1" height="1"/>`), "safe").detail).toMatch(/onclick/);
    expect(check(svg(`<image href="https://example.com/a.png" width="1" height="1"/>`), "safe").detail).toMatch(/external link/);
    expect(check(svg(`<style>@import url(https://x.com/a.css);</style>`), "safe").passed).toBe(false);
  });

  it("allows internal references", () => {
    expect(check(svg(`<defs><circle id="d" r="1"/></defs><use href="#d"/><rect fill="url(#g)" width="1" height="1"/>`), "safe").passed).toBe(true);
  });
});

describe("path parser", () => {
  it("handles arc flags written without spaces", () => {
    // A half circle of radius 50 from (100,100) to (200,100), bulging upwards.
    const box = boxFromPoints(pathPoints("M100 100a50 50 0 01100 0"))!;
    expect(box.minY).toBeCloseTo(50, 0);
    expect(box.maxX).toBeCloseTo(200, 0);
  });

  it("repeats the previous command for extra numbers", () => {
    const box = boxFromPoints(pathPoints("M 0 0 10 10 20 0"))!;
    expect(box.maxX).toBe(20);
  });
});
