/**
 * Vendored Byreal `-o json` parsing helpers (pure) — copied from the agent so the web app
 * is self-contained. Responses are wrapped `{success, meta, data}` with numeric fields as
 * strings, some with `%`/`$`/`K/M/B` suffixes.
 */
export function unwrap<T>(raw: unknown): T {
  const env = raw as { success?: boolean; data?: T };
  if (env && typeof env === "object" && "data" in env) {
    if (env.success === false) throw new Error("Byreal CLI returned success:false");
    return env.data as T;
  }
  return raw as T;
}

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

export function parsePct(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return undefined;
  const n = Number(v.trim().replace(/%$/, ""));
  return Number.isNaN(n) ? undefined : n / 100;
}
