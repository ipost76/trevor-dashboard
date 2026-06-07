import { NextResponse } from "next/server";
import { gatewayWrite } from "@/lib/gateway-client";

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

  // W-C-P2a: routed through the gateway → VM. LIVE_EDIT_ENABLED is re-checked
  // authoritatively VM-side (helper exits 3 → 423 when locked, exit 1 → 400 bad
  // input); the change_log audit lands there. UX contract unchanged.
  return gatewayWrite(
    "config.set",
    { key, value, author },
    { actor: `hub:${author}`, reason: `config.set:${key}` },
  );
}
