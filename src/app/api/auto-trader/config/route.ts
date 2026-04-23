import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// REST endpoint for auto_config CRUD (P1 overhaul, 2026-04-23).
//
// GET  -> { ok, config: { KEY: VALUE, ... }, allowed_write_keys: [...] }
// PUT  -> body { key, value }  (only keys in ALLOWED_WRITE_KEYS)
//
// Whitelist is enforced in both this route AND inside the Python writer.
// No other table is ever touched. Middleware handles auth.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_WRITE_KEYS = new Set<string>([
  "AUTO_TRADER_ENABLED",
  "MAX_CONCURRENT",
  "MAX_TRADES_PER_DAY",
  "MAX_CONSECUTIVE_LOSSES",
  "PAUSE_AFTER_LOSSES_MINUTES",
  "AGGRESSIVE_THRESHOLD",
  "TICKER_DISCOVERY",
  "CAPITAL_USD",
  "PER_TRADE_USD",
  "LEVERAGE_DEFAULT",
]);

export async function GET() {
  try {
    const raw = runPython("query_auto_trader_config.py", ["get"], { timeout: 5_000 });
    const data = safeJsonParse<{
      ok: boolean;
      config: Record<string, string>;
      allowed_write_keys: string[];
      error?: string;
    }>(raw, { ok: false, config: {}, allowed_write_keys: [...ALLOWED_WRITE_KEYS] });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        config: {},
        allowed_write_keys: [...ALLOWED_WRITE_KEYS],
        error: String(e),
      },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as { key?: unknown; value?: unknown };
    const key = String(body?.key ?? "").trim();
    const value = body?.value == null ? "" : String(body.value);

    if (!key) {
      return NextResponse.json({ ok: false, error: "missing key" }, { status: 400 });
    }
    if (!ALLOWED_WRITE_KEYS.has(key)) {
      return NextResponse.json(
        { ok: false, error: `key not allowed: ${key}` },
        { status: 400 }
      );
    }
    // Python helper runs its own validation too
    const raw = runPython("query_auto_trader_config.py", ["set", key, value], {
      timeout: 5_000,
    });
    const data = safeJsonParse<{ ok: boolean; key?: string; value?: string; error?: string }>(
      raw,
      { ok: false, error: "parse error" }
    );
    if (!data?.ok) {
      return NextResponse.json(data, { status: 400 });
    }
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
