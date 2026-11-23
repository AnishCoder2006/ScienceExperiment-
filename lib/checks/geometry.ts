// Small 2D geometry toolkit used by the "inside viewBox" check.
// Everything works in SVG user units. We do not render the SVG, we compute
// bounding boxes from the attributes, which is fast and works on a server.

export type Point = [number, number];

/** SVG matrix [a b c d e f], the same layout as the transform="matrix(...)" function. */
export type Matrix = [number, number, number, number, number, number];

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m × n: apply n first, then m. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

export function applyToPoint(m: Matrix, [x, y]: Point): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export const translate = (tx: number, ty = 0): Matrix => [1, 0, 0, 1, tx, ty];
export const scale = (sx: number, sy = sx): Matrix => [sx, 0, 0, sy, 0, 0];

export function rotate(deg: number, cx = 0, cy = 0): Matrix {
  const r = (deg * Math.PI) / 180;
  const rot: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
  // Rotating around (cx, cy) = move to origin, rotate, move back.
  return multiply(translate(cx, cy), multiply(rot, translate(-cx, -cy)));
}

const NUMBER = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

export function parseNumbers(text: string | null | undefined): number[] {
  return (text ?? "").match(NUMBER)?.map(Number) ?? [];
}

/** Build one matrix from a single transform function such as "rotate(30 100 100)". */
export function transformFunction(name: string, args: number[]): Matrix {
  switch (name) {
    case "matrix":
      return args.length === 6 ? (args as Matrix) : IDENTITY;
    case "translate":
      return translate(args[0] ?? 0, args[1] ?? 0);
    case "scale":
      return scale(args[0] ?? 1, args[1] ?? args[0] ?? 1);
    case "rotate":
      return rotate(args[0] ?? 0, args[1] ?? 0, args[2] ?? 0);
    case "skewX":
      return [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    case "skewY":
      return [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    default:
      return IDENTITY;
  }
}

/** Parse a full transform attribute, e.g. "translate(10 20) rotate(45)". */
export function parseTransform(attr: string | null | undefined): Matrix {
  let result = IDENTITY;
  if (!attr) return result;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (const match of attr.matchAll(re)) {
    result = multiply(result, transformFunction(match[1], parseNumbers(match[2])));
  }
  return result;
}

export function boxFromPoints(points: Point[]): Box | null {
  if (points.length === 0) return null;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }
  return Number.isFinite(box.minX) ? box : null;
}

export function union(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function pad(box: Box, amount: number): Box {
  return {
    minX: box.minX - amount,
    minY: box.minY - amount,
    maxX: box.maxX + amount,
    maxY: box.maxY + amount,
  };
}

/** Transform the 4 corners of a box and return the box around them. */
export function transformBox(box: Box, m: Matrix): Box {
  const corners: Point[] = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.minX, box.maxY],
    [box.maxX, box.maxY],
  ];
  return boxFromPoints(corners.map((p) => applyToPoint(m, p)))!;
}

// ---------------------------------------------------------------------------
// Path data ("d" attribute)
// ---------------------------------------------------------------------------

const COMMANDS = "MmZzLlHhVvCcSsQqTtAa";

/** Reads numbers, flags and commands from a path string one at a time. */
class PathReader {
  private i = 0;
  constructor(private readonly s: string) {}

  private skipSeparators() {
    while (this.i < this.s.length && /[\s,]/.test(this.s[this.i])) this.i++;
  }

  atEnd(): boolean {
    this.skipSeparators();
    return this.i >= this.s.length;
  }

  /** Returns and consumes the next command letter, or null if a number comes next. */
  command(): string | null {
    this.skipSeparators();
    const c = this.s[this.i];
    if (c && COMMANDS.includes(c)) {
      this.i++;
      return c;
    }
    return null;
  }

  number(): number {
    this.skipSeparators();
    const re = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/y;
    re.lastIndex = this.i;
    const m = re.exec(this.s);
    if (!m) throw new Error(`Bad number in path at ${this.i}`);
    this.i += m[0].length;
    return parseFloat(m[0]);
  }

  /** Arc flags are a single 0 or 1 and may be written without spaces ("a1 1 0 01 5 5"). */
  flag(): number {
    this.skipSeparators();
    const c = this.s[this.i];
    if (c !== "0" && c !== "1") throw new Error(`Bad arc flag at ${this.i}`);
    this.i++;
    return Number(c);
  }
}

const CURVE_STEPS = 16;

function sampleCubic(p0: Point, p1: Point, p2: Point, p3: Point): Point[] {
  const out: Point[] = [];
  for (let s = 1; s <= CURVE_STEPS; s++) {
    const t = s / CURVE_STEPS;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

function sampleQuad(p0: Point, p1: Point, p2: Point): Point[] {
  const out: Point[] = [];
  for (let s = 1; s <= CURVE_STEPS; s++) {
    const t = s / CURVE_STEPS;
    const u = 1 - t;
    out.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ]);
  }
  return out;
}

/** Elliptical arc, converted to centre form (SVG spec appendix B.2.4) and sampled. */
function sampleArc(
  [x1, y1]: Point,
  rxIn: number,
  ryIn: number,
  angleDeg: number,
  largeArc: number,
  sweep: number,
  [x2, y2]: Point,
): Point[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [[x2, y2]];

  const phi = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;

  // Radii that are too small are scaled up so the arc can reach the end point.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }

  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (largeArc !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const out: Point[] = [];
  const steps = 24;
  for (let s = 1; s <= steps; s++) {
    const t = theta1 + (delta * s) / steps;
    out.push([
      cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
      cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
    ]);
  }
  return out;
}

/** Returns points on the outline of a path. Curves and arcs are sampled. */
export function pathPoints(d: string): Point[] {
  const r = new PathReader(d);
  const points: Point[] = [];
  let cur: Point = [0, 0];
  let start: Point = [0, 0];
  let lastCubic: Point | null = null; // second control point of the last C/S
  let lastQuad: Point | null = null; // control point of the last Q/T
  let prev = "";

  try {
    while (!r.atEnd()) {
      let cmd = r.command();
      if (!cmd) {
        // Numbers without a command repeat the previous command (M becomes L).
        if (!prev || prev === "Z" || prev === "z") break;
        cmd = prev === "M" ? "L" : prev === "m" ? "l" : prev;
      }
      const rel = cmd === cmd.toLowerCase();
      const pt = (): Point => {
        const x = r.number();
        const y = r.number();
        return rel ? [cur[0] + x, cur[1] + y] : [x, y];
      };
      let nextCubic: Point | null = null;
      let nextQuad: Point | null = null;

      switch (cmd.toUpperCase()) {
        case "M":
          cur = pt();
          start = cur;
          points.push(cur);
          break;
        case "L":
          cur = pt();
          points.push(cur);
          break;
        case "H": {
          const x = r.number();
          cur = [rel ? cur[0] + x : x, cur[1]];
          points.push(cur);
          break;
        }
        case "V": {
          const y = r.number();
          cur = [cur[0], rel ? cur[1] + y : y];
          points.push(cur);
          break;
        }
        case "C": {
          const c1 = pt();
          const c2 = pt();
          const end = pt();
          points.push(...sampleCubic(cur, c1, c2, end));
          nextCubic = c2;
          cur = end;
          break;
        }
        case "S": {
          // First control point is the reflection of the previous one.
          const c1: Point = lastCubic ? [2 * cur[0] - lastCubic[0], 2 * cur[1] - lastCubic[1]] : cur;
          const c2 = pt();
          const end = pt();
          points.push(...sampleCubic(cur, c1, c2, end));
          nextCubic = c2;
          cur = end;
          break;
        }
        case "Q": {
          const c = pt();
          const end = pt();
          points.push(...sampleQuad(cur, c, end));
          nextQuad = c;
          cur = end;
          break;
        }
        case "T": {
          const c: Point = lastQuad ? [2 * cur[0] - lastQuad[0], 2 * cur[1] - lastQuad[1]] : cur;
          const end = pt();
          points.push(...sampleQuad(cur, c, end));
          nextQuad = c;
          cur = end;
          break;
        }
        case "A": {
          const rx = r.number();
          const ry = r.number();
          const rotation = r.number();
          const large = r.flag();
          const sweep = r.flag();
          const end = pt();
          points.push(...sampleArc(cur, rx, ry, rotation, large, sweep, end));
          cur = end;
          break;
        }
        case "Z":
          cur = start;
          break;
      }
      lastCubic = nextCubic;
      lastQuad = nextQuad;
      prev = cmd;
    }
  } catch {
    // A malformed path: browsers draw everything up to the error, so do we.
  }
  return points;
}

// ---------------------------------------------------------------------------
// Text width
// ---------------------------------------------------------------------------

/**
 * Rough width of a string in a sans-serif font, in units of font-size (em).
 * Good enough to catch labels that run off the edge; it is not exact.
 */
export function estimateTextWidth(text: string, fontSize: number, bold = false): number {
  let em = 0;
  for (const ch of text) {
    if (" ".includes(ch)) em += 0.28;
    else if ("iIl.,:;'|!()[]1jtfr".includes(ch)) em += 0.32;
    else if ("mwMW@%".includes(ch)) em += 0.85;
    else if (/[A-Z]/.test(ch)) em += 0.67;
    else em += 0.55;
  }
  return em * fontSize * (bold ? 1.08 : 1);
}
