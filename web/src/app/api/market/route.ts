import { NextResponse } from "next/server";
import { getMarket } from "@/server/market";

export const dynamic = "force-dynamic"; // always read live

export async function GET() {
  const snapshot = await getMarket();
  return NextResponse.json(snapshot);
}
