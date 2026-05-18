import { NextResponse } from "next/server";
import { execSync } from "child_process";

// /api/aggressive — Aggressive Mode toggle + status (legacy GET, flag-gated POST)
//
// GET  → 15s in-memory cache, calls query_aggressive_mode.py status (read-only)
// POST → writes AGGRESSIVE_ON / AGGRESSIVE_OFF / AGGRESSIVE_EXTEND to hub_commands.
//        G2 (2026-05-01): now gated by HUB_AGGRESSIVE_TOGGLE_ENABLED — same
//        flag enforced by /api/memory/aggressive. Single contract for any
//        aggressive write surface.
//
// Auth: middleware enforces session cookie on all /api/* (except /api/auth, /api/health)

export const dynamic = "force-dynamic";

const PY = "/home/trevor/trevor/venv/bin/python";
const HELPER = "/home/trevor/trevor-dashboard/query_aggressive_mode.py";
const GATE_HELPER = "/home/trevor/trevor-dashboard/query_aggressive.py";

let _cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL = 15_000; // 15s — matches /api/circuit-breaker

function shellQuote(s: string): string {
  // Escape single quotes for safe inclusion in single-quoted shell strings
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function isToggleEnabled(): boolean {
  try {
    const raw = execSync(`${PY} ${GATE_HELPER}`, { timeout: 5000, encoding: "utf-8" });
    const data = JSON.parse(raw) as { toggle_enabled?: boolean };
    return data.toggle_enabled === true;
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const now = Date.now();
    if (_cache && now - _cache.ts < CACHE_TTL) {
      return NextResponse.json(_cache.data);
    }
    const raw = execSync(`${PY} ${HELPER} status`, {
      timeout: 10_000,
      encoding: "utf-8",
    });
    const data = JSON.parse(raw);
    _cache = { data, ts: now };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { enabled: false, threshold_delta: 0, error: String(e) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  // G2 flag gate — single contract across all aggressive write surfaces.
  if (!isToggleEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        gate_locked: true,
        error:
          "HUB_AGGRESSIVE_TOGGLE_ENABLED is false. Toggle it in auto_config to allow writes.",
      },
      { status: 423 },
    );
  }
  // Invalidate cache immediately on any POST
  _cache = null;
  try {
    const body = await request.json();
    const action = String(body.action || "").toLowerCase();

    if (action === "enable") {
      const delta = parseInt(String(body.delta ?? -5), 10);
      const hours = parseFloat(String(body.hours ?? 48));
      const reason = String(body.reason || "hub_toggle");
      const cmd = `${PY} ${HELPER} enable ${delta} ${hours} ${shellQuote(reason)}`;
      const raw = execSync(cmd, { timeout: 10_000, encoding: "utf-8" });
      return NextResponse.json(JSON.parse(raw));
    }

    if (action === "disable") {
      const reason = String(body.reason || "hub_toggle");
      const cmd = `${PY} ${HELPER} disable ${shellQuote(reason)}`;
      const raw = execSync(cmd, { timeout: 10_000, encoding: "utf-8" });
      return NextResponse.json(JSON.parse(raw));
    }

    if (action === "extend") {
      const hours = parseFloat(String(body.hours ?? 24));
      const reason = String(body.reason || "hub_extend");
      const cmd = `${PY} ${HELPER} extend ${hours} ${shellQuote(reason)}`;
      const raw = execSync(cmd, { timeout: 10_000, encoding: "utf-8" });
      return NextResponse.json(JSON.parse(raw));
    }

    return NextResponse.json(
      { ok: false, error: `Unknown action: ${action}. Use enable|disable|extend.` },
      { status: 400 }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e) },
      { status: 500 }
    );
  }
}
