import { NextRequest, NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// Rule 26 — user input reaches Python only as spawnSync argv via runPython()
// (no shell, no string interpolation). The checks below are defense-in-depth
// input validation layered on top of that argv bridge.
const TICKER_RE = /^[A-Z0-9]{1,20}$/;
const ALLOWED_MODES: string[] = ["scalp", "lt", "both"];

export async function GET() {
  try {
    const raw = runPython("manage_watchlist.py", ["list"], { timeout: 10_000 });
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json({ items: [], error: String(err) });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const ticker = (body.ticker || "").toUpperCase();
  const mode = body.mode || "scalp";

  if (!ticker) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json(
      { error: "Invalid ticker — must match [A-Z0-9]{1,20}" },
      { status: 400 }
    );
  }
  if (!ALLOWED_MODES.includes(mode)) {
    return NextResponse.json(
      { error: "Invalid mode — must be one of: scalp, lt, both" },
      { status: 400 }
    );
  }

  try {
    const raw = runPython("manage_watchlist.py", ["add", ticker, mode], {
      timeout: 10_000,
    });
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get("ticker") || "").toUpperCase();
  const mode = searchParams.get("mode") || "scalp";

  if (!ticker) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json(
      { error: "Invalid ticker — must match [A-Z0-9]{1,20}" },
      { status: 400 }
    );
  }
  if (!ALLOWED_MODES.includes(mode)) {
    return NextResponse.json(
      { error: "Invalid mode — must be one of: scalp, lt, both" },
      { status: 400 }
    );
  }

  try {
    const raw = runPython("manage_watchlist.py", ["remove", ticker, mode], {
      timeout: 10_000,
    });
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
