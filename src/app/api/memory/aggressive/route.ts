import { NextResponse } from "next/server";
import { runPython, runPythonResult } from "@/lib/api-helpers";

// /api/memory/aggressive — G2 single-write surface for Aggressive Mode.
//
// GET  → query_aggressive.py     (read-only state + flag + last 5 audit rows)
// POST → set_aggressive.py       (flag-gated, idempotent, audit-row-on-change)
//        Body: { value: "true" | "false", author: string }
//        Responses:
//          200 — toggled or idempotent no-op (JSON includes prev/new values)
//          400 — bad request
//          423 — HUB_AGGRESSIVE_TOGGLE_ENABLED is false (gate locked)
//          500 — internal / DB error
//
// Auth: middleware enforces session cookie on all /api/* (except auth/health).

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stdout = await runPython("query_aggressive.py", []);
    return NextResponse.json(JSON.parse(stdout));
  } catch (e) {
    return NextResponse.json(
      {
        enabled: false,
        threshold_delta: 0,
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

  // runPythonResult (async, NOT runPython) so we can read stdout regardless
  // of exit code — set_aggressive.py exits 3 on gate-lock and we still want to
  // surface its JSON payload to the caller (and map exit 3 → HTTP 423).
  // Async → never blocks the loop; hung child SIGKILLed (process-group) at timeout.
  let result;
  try {
    result = await runPythonResult("set_aggressive.py", [value, author], { timeout: 10000 });
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

  if (result.status === 0) {
    return NextResponse.json(parsed, { status: 200 });
  }
  if (result.status === 3) {
    return NextResponse.json(parsed, { status: 423 });
  }
  if (result.status === 1) {
    return NextResponse.json(parsed, { status: 400 });
  }
  // Anything else (incl. 2 = DB error, or unexpected non-zero)
  return NextResponse.json(
    {
      ...parsed,
      stderr: (result.stderr || "").slice(0, 500),
      exit_code: result.status,
    },
    { status: 500 },
  );
}
