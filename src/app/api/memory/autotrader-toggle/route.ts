import { NextResponse } from "next/server";
import { runPython, runPythonResult } from "@/lib/api-helpers";

// /api/memory/autotrader-toggle — Single Hub write surface for the
// AutoTrader on/off toggle (Rule 32 carve-out, 2026-05-02).
//
// GET  → query_autotrader_enabled.py   (read-only state + gate flag + last 5 audit rows)
// POST → set_autotrader_enabled.py     (flag-gated, idempotent, audit-row-on-change)
//        Body: { value: "true" | "false", author: string }
//        Responses:
//          200 — toggled or idempotent no-op (JSON includes prev/new values)
//          400 — bad request
//          423 — HUB_AUTOTRADER_TOGGLE_ENABLED is false (gate locked)
//          500 — internal / DB error
//
// Auth: middleware enforces session cookie on all /api/* (except auth/health).
// Mirrors /api/memory/aggressive contract exactly so the UI side can copy
// the existing 2-tap BottomSheet flow.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stdout = await runPython("query_autotrader_enabled.py", []);
    return NextResponse.json(JSON.parse(stdout));
  } catch (e) {
    return NextResponse.json(
      {
        enabled: true,
        toggle_enabled: false,
        killswitch_enabled: false,
        audit: [],
        error: String(e),
      },
      { status: 200 },
    );
  }
}

export async function POST(request: Request) {
  let body: { value?: unknown; author?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const value = String(body.value ?? "").trim().toLowerCase();
  const author = String(body.author ?? "ghost").trim() || "ghost";
  if (value !== "true" && value !== "false") {
    return NextResponse.json(
      { ok: false, error: "value must be 'true' or 'false'" },
      { status: 400 },
    );
  }

  // runPythonResult (async, NOT runPython) so we read stdout regardless of exit
  // code — set_autotrader_enabled.py exits 3 on gate-lock and we want to
  // surface its JSON payload while mapping exit 3 → HTTP 423. argv passes
  // values without shell interpolation per Rule 26. Async → never blocks the loop.
  let result;
  try {
    result = await runPythonResult("set_autotrader_enabled.py", [value, author], { timeout: 10000 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }

  if (result.timedOut || result.signal) {
    return NextResponse.json(
      { ok: false, error: result.timedOut ? "python timed out" : `python killed by ${result.signal}` },
      { status: 500 },
    );
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse((result.stdout || "").trim() || "{}");
  } catch {
    parsed = { ok: false, raw: (result.stdout || "").slice(0, 500), error: "non-JSON output" };
  }

  if (result.status === 0) return NextResponse.json(parsed, { status: 200 });
  if (result.status === 3) return NextResponse.json(parsed, { status: 423 });
  if (result.status === 1) return NextResponse.json(parsed, { status: 400 });
  return NextResponse.json(
    {
      ...parsed,
      stderr: (result.stderr || "").slice(0, 500),
      exit_code: result.status,
    },
    { status: 500 },
  );
}
