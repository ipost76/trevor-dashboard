import { NextResponse } from "next/server";
import { execSync } from "child_process";

// /api/optuna — Optuna A/B Shadow Mode status + recent comparisons
//
// GET ?scope=status (default)      → config + counters + derived rates + last hour
// GET ?scope=recent[&limit=N]      → N most recent shadow comparisons (default 20)
//
// 60s in-memory cache per scope+args. Auth: middleware enforces session cookie.

export const dynamic = "force-dynamic";

const PY = "/home/trevor/trevor/venv/bin/python";
const HELPER = "/home/trevor/trevor-dashboard/query_optuna_shadow.py";
const CACHE_TTL = 60_000;

const _cache: Map<string, { data: unknown; ts: number }> = new Map();

function runHelper(args: string): unknown {
  const cmd = `${PY} ${HELPER} ${args}`;
  const raw = execSync(cmd, { timeout: 15_000, encoding: "utf-8" });
  return JSON.parse(raw);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = (url.searchParams.get("scope") || "status").toLowerCase();
    const limit = url.searchParams.get("limit") || "20";

    const cacheKey = `${scope}|${limit}`;
    const cached = _cache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.ts < CACHE_TTL) {
      return NextResponse.json({ cached: true, ...(cached.data as object) });
    }

    let args = "status";
    if (scope === "recent") {
      const n = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
      args = `recent ${n}`;
    } else if (scope !== "status") {
      return NextResponse.json(
        { error: `unknown scope: ${scope}` },
        { status: 400 }
      );
    }

    const data = runHelper(args);
    _cache.set(cacheKey, { data, ts: now });
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "query_optuna_shadow failed", detail: message },
      { status: 500 }
    );
  }
}
