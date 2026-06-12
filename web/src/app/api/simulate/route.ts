import { NextResponse } from "next/server";
import { runSimulate, type SimulateInput } from "@/server/market";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<SimulateInput>;
  const senior = Number(body.senior);
  const junior = Number(body.junior);
  const entry = Number(body.entry);
  const width = Number(body.width ?? 0.15);
  if (![senior, junior, entry].every((n) => Number.isFinite(n) && n > 0)) {
    return NextResponse.json({ ok: false, error: "senior, junior, entry must be positive numbers." }, { status: 400 });
  }
  const result = await runSimulate({ senior, junior, entry, width });
  return NextResponse.json(result);
}
