import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { runPython, runPythonInline } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// In-memory cache for active trades (15s TTL)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _activeTradesCache: { data: any; ts: number } | null = null;
const ACTIVE_CACHE_TTL = 15_000;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "active";
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 500);
  const offset = parseInt(searchParams.get("offset") || "0");

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const dashboardDir = process.cwd();
  const scriptPath = join(dashboardDir, "query_trades.py");

  try {
    const { execSync } = await import("child_process");

    if (scope === "active") {
      if (_activeTradesCache && (Date.now() - _activeTradesCache.ts) < ACTIVE_CACHE_TTL) {
        return NextResponse.json({ ..._activeTradesCache.data, cached: true });
      }
      const raw = execSync(
        `${pythonPath} ${scriptPath} active`,
        { encoding: "utf-8", timeout: 15000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
      ).trim();
      const parsed = JSON.parse(raw);
      _activeTradesCache = { data: parsed, ts: Date.now() };
      return NextResponse.json(parsed);
    }

    if (scope === "history") {
      const filters: Record<string, string> = {};
      const ticker = searchParams.get("ticker");
      const outcome = searchParams.get("outcome");
      const direction = searchParams.get("direction");
      const search = searchParams.get("search");
      if (ticker) filters.ticker = ticker;
      if (outcome) filters.outcome = outcome;
      if (direction) filters.direction = direction;
      if (search) filters.search = search;

      // Rule 26 — args (incl. user filters) cross as a spawnSync argv array via runPython(), never a shell string.
      const raw = runPython(
        "query_trades.py",
        ["history", String(limit), String(offset), JSON.stringify(filters)],
        { timeout: 15000 }
      );
      const data = JSON.parse(raw);
      return NextResponse.json({ ...data, limit, offset });
    }

    if (scope === "watchlist") {
      const raw = execSync(
        `${pythonPath} ${scriptPath} watchlist`,
        { encoding: "utf-8", timeout: 10000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
      ).trim();
      return NextResponse.json(JSON.parse(raw));
    }

    return NextResponse.json({ error: "Unknown scope. Use ?scope=active|history|watchlist" }, { status: 400 });
  } catch (err) {
    const errMsg = String(err);
    if (scope === "active") {
      return NextResponse.json({ trades: [], stats: {}, recentSignals: [], error: errMsg });
    }
    if (scope === "history") {
      return NextResponse.json({ records: [], total: 0, limit, offset, error: errMsg });
    }
    return NextResponse.json({ items: [], error: errMsg });
  }
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, notes, training_status } = body;

  if (id == null) {
    return NextResponse.json({ error: "Missing trade id" }, { status: 400 });
  }

  const payload = JSON.stringify({ id, notes, training_status });

  try {
    // Rule 26 — payload crosses as a spawnSync argv element via runPython(), never a shell string.
    const raw = runPython("query_trades.py", ["annotate", payload], { timeout: 10000 });
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json({ error: String(err), ok: false }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { id, ids, trade_id } = body;

  try {
    // Rule 26 — ids / deleteId cross as spawnSync argv elements via runPython(), never a shell string.
    if (Array.isArray(ids) && ids.length > 0) {
      const raw = runPython(
        "query_trades.py",
        ["bulk_update", JSON.stringify(ids), "EXCLUDE"],
        { timeout: 15000 }
      );
      return NextResponse.json(JSON.parse(raw));
    }

    const deleteId = trade_id || id;
    if (deleteId != null) {
      const raw = runPython("query_trades.py", ["delete_trade", String(deleteId)], { timeout: 15000 });
      return NextResponse.json(JSON.parse(raw));
    }

    return NextResponse.json({ error: "Missing id, trade_id, or ids" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err), ok: false }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { trade_id, margin_usd } = body;

  // Strict validation: trade_id must be a non-empty string, margin_usd a finite positive number.
  if (
    typeof trade_id !== "string" ||
    trade_id.length === 0 ||
    trade_id.length > 200 ||
    typeof margin_usd !== "number" ||
    !Number.isFinite(margin_usd) ||
    margin_usd <= 0
  ) {
    return NextResponse.json({ error: "Missing trade_id or invalid margin_usd" }, { status: 400 });
  }

  const code = `
import sqlite3, json, os
db_path = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")
trade_id = os.environ.get("PATCH_TRADE_ID", "")
margin_usd = float(os.environ.get("PATCH_MARGIN_USD", "0") or "0")
conn = sqlite3.connect(db_path)
conn.execute("UPDATE active_trades SET margin_usd=? WHERE trade_id=?", (margin_usd, trade_id))
conn.commit()
r = conn.execute("SELECT margin_usd, leverage FROM active_trades WHERE trade_id=?", (trade_id,)).fetchone()
conn.close()
if r:
    print(json.dumps({"ok": True, "margin_usd": r[0], "notional": round(r[0] * (r[1] or 1), 2)}))
else:
    print(json.dumps({"ok": False, "error": "Trade not found"}))
`;

  try {
    const raw = runPythonInline(code, {
      timeout: 5000,
      env: { PATCH_TRADE_ID: trade_id, PATCH_MARGIN_USD: String(margin_usd) },
    });
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json({ error: String(err), ok: false }, { status: 500 });
  }
}
