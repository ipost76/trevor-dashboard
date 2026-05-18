import { NextResponse } from "next/server";
import { spawnSync } from "child_process";

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

function runHelper(args: string[]): unknown {
  // Rule 26 — spawnSync argv array, no shell. Args cross as argv, never a shell string.
  const proc = spawnSync(PY, [HELPER, ...args], { timeout: 15_000, encoding: "utf-8" });
  if (proc.error) throw proc.error;
  if (proc.status !== 0) {
    throw new Error(`query_optuna_shadow exit=${proc.status}: ${(proc.stderr || "").slice(0, 500)}`);
  }
  return JSON.parse(proc.stdout);
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

    let args: string[] = ["status"];
    if (scope === "recent") {
      const n = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
      args = ["recent", String(n)];
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
