import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic"; // always read the latest feed

const LIVE_PATH = join(process.cwd(), "..", "tranche-strategy", "config", "live.json");

export async function GET() {
  try {
    const raw = await readFile(LIVE_PATH, "utf8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ running: false, cycles: [], summary: { cycles: 0, rebalances: 0 } });
  }
}
