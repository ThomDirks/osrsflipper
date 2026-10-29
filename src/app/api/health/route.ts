import { NextResponse } from "next/server";
import { getMarketService } from "@/lib/market/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { ok: true, source: getMarketService().sourceKind, time: Date.now(), build: process.env.APP_BUILD ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
