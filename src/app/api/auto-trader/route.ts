import { NextResponse } from "next/server";
import { execSync } from "child_process";

// /api/auto-trader — Mirrored Auto Trader snapshot (Prompt 5/6, 2026-04-21)
//
// GET → 30s in-memory cache, calls query_auto_trader.py (READ-ONLY).
// Writes (enable/disable) go through the Discord !auto command; no POST here.
//
// Auth: middleware enforces session cookie on all /api/* (except /api/auth, /api/health).

export const dynamic = "force-dynamic";

const PY = "/home/trevor/trevor/venv/bin/python";
const HELPER = "/home/trevor/trevor-dashboard/query_auto_trader.py";

let _cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL = 30_000; // 30s — matches auto_trader_monitor_loop cadence

export async function GET() {
  try {
    const now = Date.now();
    if (_cache && now - _cache.ts < CACHE_TTL) {
      return NextResponse.json(_cache.data);
    }
    const raw = execSync(`${PY} ${HELPER}`, {
      timeout: 10_000,
      encoding: "utf-8",
    });
    const data = JSON.parse(raw);
    _cache = { data, ts: now };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      {
        enabled: false,
        equity: 0,
        open_positions: [],
        recent_trades: [],
        stats_7d: {
          total_trades: 0,
          wins: 0,
          losses: 0,
          win_rate: 0,
          total_pnl: 0,
        },
        config: {},
        error: String(e),
      },
      { status: 500 }
    );
  }
}
