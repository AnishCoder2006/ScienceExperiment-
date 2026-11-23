import type { Element } from "@xmldom/xmldom";
import {
  type Box,
  type Matrix,
  type Point,
  IDENTITY,
  boxFromPoints,
  estimateTextWidth,
  multiply,
  pad,
  parseNumbers,
  parseTransform,
  pathPoints,
  transformBox,
  transformFunction,
  translate,
  union,
} from "./geometry";
import { StyleSheet, cssLength } from "./styles";

// "Nothing is drawn outside the viewBox."
// We walk the SVG tree, keep track of every transform (including the ones that
// SMIL animations apply over time), compute each element's box and compare it
// with the viewBox. CSS keyframe motion is not simulated (see README).

/** Elements that are never drawn directly. */
const NOT_DRAWN = new Set([
  "defs", "clipPath", "mask", "marker", "pattern", "symbol", "linearGradient",
  "radialGradient", "filter", "title", "desc", "metadata", "style", "script",
  "animate", "animateTransform", "animateMotion", "set", "mpath",
]);

/** Attributes whose animation changes an element's geometry. */
const GEOMETRY_ATTRS = new Set([
  "x", "y", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "width", "height", "points", "d",
]);

/** Cap on how many transform variants we track per element, to keep the check fast. */
const MAX_VARIANTS = 64;

export interface Overflow {
  element: string;
  box: Box;
  edges: string[];
}

export interface BoundsReport {
  drawnElements: number;
  overflows: Overflow[];
}

const childElements = (el: Element): Element[] =>
  Array.from(el.childNodes).filter((n) => n.nodeType === 1) as unknown as Element[];

/** Split a SMIL `values` list, or fall back to from/to. */
function animationValues(anim: Element): string[] {
  const values = anim.getAttribute("values");
  if (values) return values.split(";").map((v) => v.trim()).filter(Boolean);
  return [anim.getAttribute("from"), anim.getAttribute("to")].filter((v): v is string => !!v);
}

/**
 * True when an animation starts on the first frame and never lets go: it repeats forever,
 * or freezes on its last value. Then the element's own (base) value is never on screen,
 * so it should not count. A delayed or click-triggered animation shows the base value first.
 */
function replacesBaseValue(anim: Element): boolean {
  if (anim.getAttribute("additive") === "sum" || anim.hasAttribute("by")) return false;
  const begin = (anim.getAttribute("begin") ?? "0s").split(";")[0].trim();
  const clock = begin.match(/^(-?\d*\.?\d+)(ms|s|min|h)?$/);
  if (!clock || parseFloat(clock[1]) > 0) return false;
  const forever = anim.getAttribute("repeatCount") === "indefinite" || anim.getAttribute("repeatDur") === "indefinite";
  return forever || anim.getAttribute("fill") === "freeze";
}

/** Pick at most `max` evenly spaced items, always keeping the first and last. */
function sample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, i) => items[Math.round((i * (items.length - 1)) / (max - 1))]);
}

/**
 * Every transform this element can have during its animation.
 * Starts with its static transform and adds one matrix per animateTransform
 * keyframe, plus in-between steps so rotations are covered along the way.
 */
function localTransforms(el: Element): Matrix[] {
  const own = parseTransform(el.getAttribute("transform"));
  const variants: Matrix[] = [];
  let baseShown = true;

  for (const anim of childElements(el)) {
    if (anim.localName === "animateTransform") {
      const type = anim.getAttribute("type") ?? "translate";
      const additive = anim.getAttribute("additive") === "sum";
      const keyframes = animationValues(anim).map(parseNumbers);
      for (let k = 0; k < keyframes.length; k++) {
        const a = keyframes[k];
        const b = keyframes[k + 1];
        const steps = b && b.length === a.length ? 6 : 1;
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          const args = a.map((v, i) => (b ? v + (b[i] - v) * t : v));
          const m = transformFunction(type, args);
          variants.push(additive ? multiply(own, m) : m);
        }
      }
    }

    if (anim.localName === "animateMotion") {
      const path = anim.getAttribute("path");
      const offsets: Point[] = path
        ? pathPoints(path)
        : animationValues(anim).map((v) => {
            const [x = 0, y = 0] = parseNumbers(v);
            return [x, y];
          });
      // Motion is applied on top of the element's own transform.
      for (const [x, y] of offsets) variants.push(multiply(translate(x, y), own));
      if (offsets.length && replacesBaseValue(anim)) baseShown = false;
    }
  }
  if (baseShown) variants.unshift(own);
  return sample(variants, MAX_VARIANTS);
}

/** Box of a basic shape in its own coordinates. `get` lets animations override attributes. */
function shapeBox(tag: string, get: (name: string) => string | null, vb: Box): Box | null {
  const width = vb.maxX - vb.minX;
  const height = vb.maxY - vb.minY;
  // Lengths may be percentages of the viewBox.
  const len = (name: string, ref: number) => {
    const v = get(name);
    if (!v) return 0;
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return 0;
    return v.trim().endsWith("%") ? (n / 100) * ref : n;
  };

  switch (tag) {
    case "rect":
    case "image":
    case "foreignObject": {
      const x = len("x", width);
      const y = len("y", height);
      return { minX: x, minY: y, maxX: x + len("width", width), maxY: y + len("height", height) };
    }
    case "circle": {
      const cx = len("cx", width);
      const cy = len("cy", height);
      const r = len("r", Math.min(width, height));
      return { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r };
    }
    case "ellipse": {
      const cx = len("cx", width);
      const cy = len("cy", height);
      const rx = len("rx", width);
      const ry = len("ry", height);
      return { minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry };
    }
    case "line":
      return boxFromPoints([
        [len("x1", width), len("y1", height)],
        [len("x2", width), len("y2", height)],
      ]);
    case "polyline":
    case "polygon": {
      const n = parseNumbers(get("points"));
      const pts: Point[] = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
      return boxFromPoints(pts);
    }
    case "path":
      return boxFromPoints(pathPoints(get("d") ?? ""));
    default:
      return null;
  }
}

/** Box of a <text> element, built from one box per line (tspans with their own x/y). */
function textBox(el: Element, get: (name: string) => string | null, styles: StyleSheet): Box | null {
  const fontSize = cssLength(styles.get(el, "font-size")) ?? 16;
  const bold = /bold|[6-9]00/.test(styles.get(el, "font-weight") ?? "");
  const anchor = styles.get(el, "text-anchor") ?? "start";
  const baseline = styles.get(el, "dominant-baseline") ?? "auto";

  const first = (v: string | null) => parseNumbers(v)[0];
  const lines: { x: number; y: number; text: string }[] = [];
  let line = { x: first(get("x")) ?? 0, y: (first(get("y")) ?? 0) + (cssLength(el.getAttribute("dy") ?? undefined, fontSize) ?? 0), text: "" };
  lines.push(line);

  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) {
      line.text += node.nodeValue ?? "";
    } else if (node.nodeType === 1) {
      const span = node as unknown as Element;
      const hasX = span.hasAttribute("x");
      const hasY = span.hasAttribute("y");
      const dy = cssLength(span.getAttribute("dy") ?? undefined, fontSize) ?? 0;
      if (hasX || hasY) {
        // A tspan with its own position starts a new line.
        line = {
          x: hasX ? first(span.getAttribute("x")) ?? line.x : line.x,
          y: (hasY ? first(span.getAttribute("y")) ?? line.y : line.y) + dy,
          text: span.textContent ?? "",
        };
        lines.push(line);
      } else {
        // An inline tspan (e.g. a superscript ²) continues the current line.
        line.text += span.textContent ?? "";
      }
    }
  }

  let box: Box | null = null;
  for (const l of lines) {
    const text = l.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const w = estimateTextWidth(text, fontSize, bold);
    const left = anchor === "middle" ? l.x - w / 2 : anchor === "end" ? l.x - w : l.x;
    let top = l.y - 0.8 * fontSize; // alphabetic baseline: most of the glyph is above y
    let bottom = l.y + 0.25 * fontSize;
    if (/middle|central/.test(baseline)) {
      top = l.y - 0.55 * fontSize;
      bottom = l.y + 0.55 * fontSize;
    } else if (/hanging|text-before-edge/.test(baseline)) {
      top = l.y;
      bottom = l.y + fontSize;
    }
    box = union(box, { minX: left, minY: top, maxX: left + w, maxY: bottom });
  }
  return box;
}

/** Union of the element's box over every value its <animate> children give to geometry attributes. */
function animatedLocalBox(el: Element, vb: Box, styles: StyleSheet): Box | null {
  const measure = (get: (n: string) => string | null) =>
    el.localName === "text" ? textBox(el, get, styles) : shapeBox(el.localName ?? "", get, vb);

  const anims = childElements(el).filter(
    (a) => a.localName === "animate" && GEOMETRY_ATTRS.has(a.getAttribute("attributeName") ?? "") && animationValues(a).length > 0,
  );
  // Attributes whose base value is never on screen use their first animated value instead.
  const replaced = new Map<string, string>();
  for (const a of anims) if (replacesBaseValue(a)) replaced.set(a.getAttribute("attributeName")!, animationValues(a)[0]);
  const base = (n: string) => replaced.get(n) ?? el.getAttribute(n);

  let box = measure(base);
  for (const anim of anims) {
    const attr = anim.getAttribute("attributeName")!;
    for (const value of animationValues(anim)) {
      box = union(box, measure((n) => (n === attr ? value : base(n))));
    }
  }
  return box;
}

function describe(el: Element): string {
  const id = el.getAttribute("id");
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  let out = `<${el.localName}`;
  if (id) out += ` id="${id}"`;
  out += ">";
  if (el.localName === "text" && text) out += ` "${text}"`;
  return out;
}

export function checkBounds(root: Element, viewBox: Box, styles: StyleSheet): BoundsReport {
  const overflows: Overflow[] = [];
  let drawnElements = 0;
  const tolerance = Math.max(2, (viewBox.maxX - viewBox.minX) * 0.005);
  const byId = new Map<string, Element>();
  const all = (el: Element) => {
    const id = el.getAttribute("id");
    if (id) byId.set(id, el);
    childElements(el).forEach(all);
  };
  all(root);

  const walk = (el: Element, parents: Matrix[], depth: number) => {
    const tag = el.localName ?? "";
    if (NOT_DRAWN.has(tag) || depth > 20) return;
    if (el.getAttribute("display") === "none") return;

    // Combine every parent transform with every transform this element can have.
    const locals = localTransforms(el);
    let matrices: Matrix[] = [];
    for (const p of parents) for (const l of locals) matrices.push(multiply(p, l));
    matrices = sample(matrices, MAX_VARIANTS);

    if (tag === "use" || tag === "svg") {
      // <use> draws another element, shifted by its x/y. A nested <svg> shifts its children.
      const shift = translate(parseFloat(el.getAttribute("x") ?? "0") || 0, parseFloat(el.getAttribute("y") ?? "0") || 0);
      const shifted = matrices.map((m) => multiply(m, shift));
      if (tag === "use") {
        const href = (el.getAttribute("href") ?? el.getAttribute("xlink:href") ?? "").replace(/^#/, "");
        const target = byId.get(href);
        if (target) {
          // A <symbol> is not drawn on its own, but it is drawn through <use>.
          const children = target.localName === "symbol" ? childElements(target) : [target];
          children.forEach((c) => walk(c, shifted, depth + 1));
        }
      } else {
        childElements(el).forEach((c) => walk(c, shifted, depth + 1));
      }
      return;
    }

    let local = animatedLocalBox(el, viewBox, styles);
    if (local) {
      drawnElements++;
      if (tag !== "text") {
        const stroke = styles.get(el, "stroke");
        if (stroke && stroke !== "none") local = pad(local, (cssLength(styles.get(el, "stroke-width")) ?? 1) / 2);
      }
      let world: Box | null = null;
      for (const m of matrices) world = union(world, transformBox(local, m));
      if (world) {
        const edges: string[] = [];
        const f = (n: number) => Math.round(n * 10) / 10;
        if (world.minX < viewBox.minX - tolerance) edges.push(`left edge at x=${f(world.minX)} (min ${viewBox.minX})`);
        if (world.maxX > viewBox.maxX + tolerance) edges.push(`right edge at x=${f(world.maxX)} (max ${viewBox.maxX})`);
        if (world.minY < viewBox.minY - tolerance) edges.push(`top edge at y=${f(world.minY)} (min ${viewBox.minY})`);
        if (world.maxY > viewBox.maxY + tolerance) edges.push(`bottom edge at y=${f(world.maxY)} (max ${viewBox.maxY})`);
        if (edges.length) overflows.push({ element: describe(el), box: world, edges });
      }
    }

    // Text children are tspans, which we already measured as part of the text.
    if (tag !== "text") childElements(el).forEach((c) => walk(c, matrices, depth + 1));
  };

  childElements(root).forEach((c) => walk(c, [IDENTITY], 0));
  return { drawnElements, overflows };
}
