import type { Element } from "@xmldom/xmldom";

// A tiny CSS reader. Models often write `<style>.label { font-size: 18px }</style>`,
// so to measure text we need to know which font-size applies to each element.
// It supports simple selectors (tag, .class, #id, tag.class) and ignores the rest.

interface Selector {
  tag?: string;
  id?: string;
  classes: string[];
}

interface Rule {
  selector: Selector;
  declarations: Record<string, string>;
}

/** Remove @keyframes, @media and other at-rule blocks, which hold no plain rules we need. */
function stripAtRules(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    if (css[i] === "@") {
      const brace = css.indexOf("{", i);
      const semi = css.indexOf(";", i);
      if (semi !== -1 && (brace === -1 || semi < brace)) {
        i = semi + 1; // e.g. @import url(...);
        continue;
      }
      if (brace === -1) break;
      // Skip to the matching closing brace.
      let depth = 0;
      let j = brace;
      for (; j < css.length; j++) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}" && --depth === 0) break;
      }
      i = j + 1;
      continue;
    }
    out += css[i++];
  }
  return out;
}

function parseSelector(text: string): Selector | null {
  // For "g.labels text" we only look at the last part ("text").
  const last = text.trim().split(/[\s>+~]+/).pop() ?? "";
  const m = /^(\*|[a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(last);
  if (!m || last === "") return null;
  const selector: Selector = { classes: [] };
  if (m[1] && m[1] !== "*") selector.tag = m[1];
  for (const part of m[2].match(/[.#][\w-]+/g) ?? []) {
    if (part[0] === ".") selector.classes.push(part.slice(1));
    else selector.id = part.slice(1);
  }
  return selector;
}

export function parseDeclarations(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of text.split(";")) {
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    out[decl.slice(0, colon).trim().toLowerCase()] = decl.slice(colon + 1).trim();
  }
  return out;
}

function matches(el: Element, s: Selector): boolean {
  if (s.tag && el.localName !== s.tag) return false;
  if (s.id && el.getAttribute("id") !== s.id) return false;
  if (s.classes.length) {
    const own = (el.getAttribute("class") ?? "").split(/\s+/);
    if (!s.classes.every((c) => own.includes(c))) return false;
  }
  return true;
}

/** Properties that children inherit from their parents. */
const INHERITED = new Set([
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "stroke",
  "stroke-width",
]);

export class StyleSheet {
  private rules: Rule[] = [];

  constructor(css: string) {
    const clean = stripAtRules(css.replace(/\/\*[\s\S]*?\*\//g, ""));
    for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const declarations = parseDeclarations(m[2]);
      for (const part of m[1].split(",")) {
        const selector = parseSelector(part);
        if (selector) this.rules.push({ selector, declarations });
      }
    }
  }

  /** The value set on this element only: inline style, then stylesheet, then attribute. */
  own(el: Element, prop: string): string | undefined {
    const inline = parseDeclarations(el.getAttribute("style") ?? "")[prop];
    if (inline) return inline;
    let fromSheet: string | undefined;
    for (const rule of this.rules) {
      if (rule.declarations[prop] && matches(el, rule.selector)) fromSheet = rule.declarations[prop];
    }
    return fromSheet ?? el.getAttribute(prop) ?? undefined;
  }

  /** The computed value, walking up to the parents for inherited properties. */
  get(el: Element, prop: string): string | undefined {
    let node: Element | null = el;
    while (node && node.nodeType === 1) {
      const value = this.own(node, prop);
      if (value && value !== "inherit") return value;
      if (!INHERITED.has(prop)) return undefined;
      node = node.parentNode as Element | null;
    }
    return undefined;
  }
}

/** Parse a CSS length like "18", "18px" or "1.2em" into user units. */
export function cssLength(value: string | undefined, fontSize = 16): number | undefined {
  if (!value) return undefined;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return undefined;
  if (value.trim().endsWith("em")) return n * fontSize;
  if (value.trim().endsWith("pt")) return n * (4 / 3);
  return n;
}
