/**
 * Parsing helpers for the REAL Byreal CLI `-o json` shape, verified 2026-06-10
 * against byreal-cli 0.3.6 / byreal-perps-cli 0.3.7.
 *
 * Reality vs. the design-doc assumptions (the Phase-0 gate did its job):
 *  - Every response is wrapped: `{ success, meta, data }`. Unwrap `.data`.
 *  - Numbers arrive as STRINGS, some with unit suffixes: "64.85", "0.04%",
 *    "44.27%", "-2.3%", "$3.92M". Parse defensively.
 */

export interface ByrealEnvelope<T> {
  success: boolean;
  meta?: { timestamp?: string; version?: string };
  data: T;
}

/** Unwrap the `{success, meta, data}` envelope; throw on `success: false`. */
export function unwrap<T>(raw: unknown): T {
  const env = raw as Partial<ByrealEnvelope<T>>;
  if (env && typeof env === "object" && "data" in env) {
    if (env.success === false) throw new Error(`Byreal CLI returned success:false: ${JSON.stringify(raw).slice(0, 300)}`);
    return env.data as T;
  }
  return raw as T; // tolerate an already-unwrapped payload
}

/** Parse "64.85", 64.85, "$3.92M", "1,234" → number. NaN-safe (returns undefined). */
export function parseNum(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  let s = v.trim().replace(/[$,]/g, "");
  let mult = 1;
  const suffix = s.slice(-1).toUpperCase();
  if (suffix === "K") mult = 1e3;
  else if (suffix === "M") mult = 1e6;
  else if (suffix === "B") mult = 1e9;
  if (mult !== 1) s = s.slice(0, -1);
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n * mult;
}

/** Parse a percent string "44.27%" / "-2.3%" → fractional 0.4427 / -0.023. */
export function parsePct(v: unknown): number | undefined {
  if (typeof v === "number") return v; // already fractional by convention
  if (typeof v !== "string") return undefined;
  const n = Number(v.trim().replace(/%$/, ""));
  return Number.isNaN(n) ? undefined : n / 100;
}

/** First defined numeric field among candidates. */
export function pickNum(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const n = parseNum(obj[k]);
    if (n !== undefined) return n;
  }
  return undefined;
}
