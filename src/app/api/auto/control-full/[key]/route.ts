import { NextResponse } from "next/server";
import { runPythonResult } from "@/lib/api-helpers";

// PATCH /api/auto/control-full/[key] — D2 (Control Center) write surface.
//
// Body: { value: "true" | "false", author?: string, reason?: string }
//   value must be 'true' or 'false' (case-insensitive). The Python helper
//   write_control_value.py handles gate + immutable + dedicated-endpoint
//   checks. Toggles with their own audited surfaces (AUTO_TRADER_ENABLED,
//   EMERGENCY_KILLSWITCH, LIVE_PARTIALS_ENABLED, CONFIRM_CYCLES_PROMOTED)
//   are rejected with 400 and a pointer to the correct endpoint.
//
//   `reason` is optional; when present it lands in change_log.notes via
//   audit_config_write. D2 Tier 1 toggles (A1 §9) require it client-side.
//
// Responses:
//   200 — flipped or idempotent no-op (JSON includes prev/new values)
//   400 — bad input (value not bool, key not bool-shaped, dedicated, immutable)
//   423 — LIVE_EDIT_ENABLED is false
//   500 — internal / DB error
//
// Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key: rawKey } = await params;
  const key = String(rawKey || "").trim();
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "missing key in path" },
      { status: 400 },
    );
  }

  let body: { value?: unknown; author?: unknown; reason?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const value = String(body.value ?? "").trim().toLowerCase();
  if (value !== "true" && value !== "false") {
    return NextResponse.json(
      { ok: false, error: "value must be 'true' or 'false'" },
      { status: 400 },
    );
  }
  const author = String(body.author ?? "ghost").trim() || "ghost";
  const reason = String(body.reason ?? "").trim();

  const argv = reason ? [key, value, author, reason] : [key, value, author];
  let result;
  try {
    result = await runPythonResult("write_control_value.py", argv, { timeout: 10_000 });
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
