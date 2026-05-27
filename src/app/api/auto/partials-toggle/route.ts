import { NextResponse } from "next/server";
import { join } from "path";
import { spawnSync } from "child_process";
import { runPython, PYTHON_PATH, DASHBOARD_DIR, TREVOR_DIR } from "@/lib/api-helpers";

// /api/auto/partials-toggle — Hub write surface for LIVE_PARTIALS_ENABLED
// (B4, 2026-05-27). Defaults to false; toggle promotes Layer 5 partial
// exits from shadow-only to live execution.
//
// GET  → query_live_partials_enabled.py    (state + gate flag + last 5 partial-toggle audit rows)
// POST → set_live_partials_enabled.py      (flag-gated, idempotent, audit-row-on-change)
//        Body: { value: "true" | "false", author?: string }
//        Responses:
//          200 — toggled or idempotent no-op (JSON includes prev/new values)
//          400 — bad request
//          423 — HUB_LIVE_PARTIALS_TOGGLE_ENABLED is false (gate locked)
//          500 — internal / DB error
//
// Auth: middleware enforces session cookie on all /api/* (except auth/health).
// Mirrors /api/memory/autotrader-toggle + /api/auto/exit-controls contracts
// line-for-line; audit rows land in autotrader_state_audit (action prefix
// 'live_partials_*') so they surface in AutoTrader Control's "Recent Toggles".

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stdout = runPython("query_live_partials_enabled.py", []);
    return NextResponse.json(JSON.parse(stdout));
  } catch (e) {
    return NextResponse.json(
      {
        enabled: false,
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

  // spawnSync directly (NOT runPython) so we read stdout regardless of exit
  // code — set_live_partials_enabled.py exits 3 on gate-lock and we want to
  // surface its JSON payload while mapping exit 3 → HTTP 423. argv passes
  // values without shell interpolation per Rule 26.
  const scriptPath = join(DASHBOARD_DIR, "set_live_partials_enabled.py");
  const result = spawnSync(PYTHON_PATH, [scriptPath, value, author], {
    encoding: "utf-8",
    timeout: 10000,
    cwd: TREVOR_DIR,
    env: { ...process.env, HOME: "/home/trevor" },
    maxBuffer: 1 * 1024 * 1024,
  });

  if (result.error) {
    return NextResponse.json({ ok: false, error: String(result.error) }, { status: 500 });
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
