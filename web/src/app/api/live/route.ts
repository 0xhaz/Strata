import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic"; // always serve the latest feed
export const runtime = "nodejs";

const EMPTY = { running: false, cycles: [], summary: { cycles: 0, rebalances: 0 } };

// Local dev: the agent writes this file and GET reads it directly (no bridge needed).
const LIVE_PATH = join(process.cwd(), "..", "tranche-strategy", "config", "live.json");

// Best-effort in-memory cache — survives within a single warm serverless instance.
let memFeed: unknown = null;

// ── Optional shared store (Upstash / Vercel KV REST) so the feed survives ACROSS
// serverless instances. Auto-configured by the Vercel KV/Upstash add-on env vars. ──
const KV_URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const KV_KEY = "strata:live-feed";

async function kvGet(): Promise<unknown | null> {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const r = await fetch(`${KV_URL}/get/${KV_KEY}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      cache: "no-store",
    });
    const j = await r.json();
    return j?.result ? JSON.parse(j.result) : null;
  } catch {
    return null;
  }
}

async function kvSet(value: unknown): Promise<void> {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    await fetch(`${KV_URL}/set/${KV_KEY}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      body: JSON.stringify(value), // stored as the string value
    });
  } catch {
    /* best effort */
  }
}

// GET — the dashboard polls this. Prefer the shared store, then warm-instance cache,
// then the local file (local dev), else an empty feed.
export async function GET() {
  const kv = await kvGet();
  if (kv) return NextResponse.json(kv);
  if (memFeed) return NextResponse.json(memFeed);
  try {
    return NextResponse.json(JSON.parse(await readFile(LIVE_PATH, "utf8")));
  } catch {
    return NextResponse.json(EMPTY);
  }
}

// POST — the agent pushes its feed here each cycle (the bridge for the deployed site).
// Protected by LIVE_INGEST_TOKEN when set (open locally when unset).
export async function POST(req: Request) {
  const token = process.env.LIVE_INGEST_TOKEN;
  if (token && req.headers.get("x-ingest-token") !== token) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let feed: unknown;
  try {
    feed = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  memFeed = feed;
  await kvSet(feed);
  return NextResponse.json({ ok: true });
}
