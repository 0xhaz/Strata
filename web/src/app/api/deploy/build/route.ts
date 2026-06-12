import { NextResponse } from "next/server";
import { buildOpenUnsigned, type DeployBuildInput } from "@/server/market";

export const dynamic = "force-dynamic";

const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<DeployBuildInput>;
  if (!body.pool || !body.walletAddress || !body.amount) {
    return NextResponse.json({ ok: false, error: "Missing pool, walletAddress, or amount." }, { status: 400 });
  }
  const result = await buildOpenUnsigned({
    pool: body.pool,
    priceLower: body.priceLower ?? 0,
    priceUpper: body.priceUpper ?? 0,
    baseMint: body.baseMint ?? SOL_MINT,
    amount: body.amount,
    walletAddress: body.walletAddress,
  });
  return NextResponse.json(result);
}
