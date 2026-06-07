import { NextRequest, NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";
import { gatewayWrite } from "@/lib/gateway-client";

export const dynamic = "force-dynamic";

// Rule 26 — user input reaches Python only as an argv element via runPython()
// (no shell, no string interpolation). TICKER_RE is defense-in-depth input
// validation layered on top of that argv bridge.
const TICKER_RE = /^[A-Z0-9]{1,20}$/;

export async function GET() {
  try {
    const raw = await runPython("manage_watchlist.py", ["list"], { timeout: 10_000 });
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json({ items: [], error: String(err) });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const ticker = (body.ticker || "").toUpperCase();

  if (!ticker) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json(
      { error: "Invalid ticker — must match [A-Z0-9]{1,20}" },
      { status: 400 }
    );
  }

  // W-C-P2a: routed through the gateway → VM (HUB_LIST_WRITE_ENABLED, audited).
  return gatewayWrite("watchlist.add", { ticker }, { reason: "watchlist.add via Hub" });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get("ticker") || "").toUpperCase();

  if (!ticker) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json(
      { error: "Invalid ticker — must match [A-Z0-9]{1,20}" },
      { status: 400 }
    );
  }

  // W-C-P2a: routed through the gateway → VM (HUB_LIST_WRITE_ENABLED, audited).
  return gatewayWrite("watchlist.remove", { ticker }, { reason: "watchlist.remove via Hub" });
}
