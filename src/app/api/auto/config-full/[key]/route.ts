import { NextResponse } from "next/server";
import { join } from "path";
import { spawnSync } from "child_process";
import { PYTHON_PATH, DASHBOARD_DIR, TREVOR_DIR } from "@/lib/api-helpers";

// PATCH /api/auto/config-full/[key] — D1 (Config editor) write surface.
//
// Body: { value: string|number, author?: string }
//   value is coerced to string and passed to write_config_value.py via argv.
//   The Python helper handles all validation (gate, immutable, bool guard).
//
// Responses:
//   200 — edited or idempotent no-op (JSON includes prev/new values)
//   400 — bad input (missing key, immutable, boolean shape, etc.)
//   423 — LIVE_EDIT_ENABLED is false (gate locked)
//   500 — DB / internal error
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

  let body: { value?: unknown; author?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  if (body.value === undefined || body.value === null) {
    return NextResponse.json(
      { ok: false, error: "body.value is required" },
      { status: 400 },
    );
  }
  const value = String(body.value);
  const author = String(body.author ?? "ghost").trim() || "ghost";

  // spawnSync directly so non-zero exit codes don't throw — write_config_value.py
  // signals gate-lock via exit 3 → HTTP 423; bad input via exit 1 → HTTP 400.
  // argv array per Rule 26 (no shell, no interpolation).
  const scriptPath = join(DASHBOARD_DIR, "write_config_value.py");
  const result = spawnSync(PYTHON_PATH, [scriptPath, key, value, author], {
    encoding: "utf-8",
    timeout: 10_000,
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
