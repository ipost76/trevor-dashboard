import { NextRequest, NextResponse } from "next/server";
import { runPythonInline } from "@/lib/api-helpers";
import { fetchHeartbeatOpenSet } from "@/lib/heartbeat-open-set";

export const dynamic = "force-dynamic";

// B4 (G5/C4, 2026-06-30): the margin preflight guard is a RISK path. It used to
// sum `margin_usd` off `active_trades WHERE status='open'` — but active_trades is
// the FROZEN table (insert-blocked since Wave E2, 2026-04-22 via
// `block_active_trades_insert`), so that query is permanently 0 and the guard was
// silently always $0 regardless of how much margin is actually posted. A risk
// guard that silently reads 0 is the worst failure mode.
//
// Posted margin now comes from the LIVE Observatory heartbeat — the same source
// the AUTO CAPITAL header / leverage-regime panel use — as Σ(notional/leverage)
// (isolated initial margin; the exact formula the live-verified
// /api/auto/leverage-regime route confirmed against the bot's live_executor.py).
// If the heartbeat is unavailable it falls back to the replica
// `auto_trades WHERE status='open' AND trade_mode='live'` (NOT the dead
// active_trades, NOT a silent 0). trade_mode='live' so a paper open can't inject
// phantom margin. Fail toward MORE caution, never less.

// Σ isolated initial margin over the heartbeat open-set: Σ(notional / leverage).
function sumPostedMargin(
  positions: { notional_usd: number; leverage: number }[],
): number {
  let m = 0;
  for (const p of positions) {
    if (p.leverage > 0 && Number.isFinite(p.notional_usd)) {
      m += p.notional_usd / p.leverage;
    }
  }
  return m;
}

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker") || "";
  const direction = (request.nextUrl.searchParams.get("direction") || "LONG").toUpperCase();

  // The live heartbeat is the PRIMARY margin signal — fetched independently of the
  // replica read so a transient DB hiccup can never zero out a real live margin.
  // fetchHeartbeatOpenSet never throws (→ null when the heartbeat is unreachable;
  // an empty array is a legitimate "flat account, 0 margin").
  const liveSet = await fetchHeartbeatOpenSet();
  const heartbeatMargin = liveSet ? sumPostedMargin(liveSet) : null;

  const code = `
import sqlite3, json, os
db_path = "/home/trevor/trevor/trevor.db"
conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
cur = conn.cursor()

ticker = os.environ.get("PF_TICKER", "")
direction = os.environ.get("PF_DIRECTION", "LONG")

# Capital
capital = 50.0
try:
    row = cur.execute("SELECT value FROM trevor_config WHERE key='trading_capital'").fetchone()
    if row: capital = float(row[0])
except: pass

# Replica margin fallback: isolated initial margin = Σ(notional / leverage) over
# LIVE open auto_trades — NOT the frozen active_trades. trade_mode='live' so a
# paper open can't inject phantom margin.
replica_margin = cur.execute(
    "SELECT COALESCE(SUM(CASE WHEN leverage > 0 THEN notional_usd / leverage ELSE 0 END), 0) "
    "FROM auto_trades WHERE status='open' AND trade_mode='live'"
).fetchone()[0]

# Track record
rec = cur.execute("SELECT COUNT(*) as total, SUM(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END) as wins, SUM(CASE WHEN pnl_pct <= 0 THEN 1 ELSE 0 END) as losses FROM trade_outcomes WHERE ticker=? AND direction=?", (ticker, direction)).fetchone()

# Block status
blocked = False
block_reason = None
try:
    blk = cur.execute("SELECT reason FROM signal_filter_rules WHERE rule_type='BLOCK_DIRECTION' AND enabled=1 AND ticker=? AND direction=?", (ticker, direction)).fetchone()
    if blk:
        blocked = True
        block_reason = blk[0]
except: pass

conn.close()
wr = round(rec[1] / rec[0] * 100, 1) if rec[0] and rec[0] > 0 else 0
print(json.dumps({
    "capital": capital,
    "replicaMargin": float(replica_margin or 0),
    "record": {"total": rec[0] or 0, "wins": rec[1] or 0, "losses": rec[2] or 0, "wr": wr},
    "blocked": blocked,
    "blockReason": block_reason,
}))
`;

  // Replica read (capital / record / block status + the margin fallback). Wrapped
  // so a DB failure degrades gracefully WITHOUT discarding a live heartbeat margin.
  let capital = 50;
  let replicaMargin = 0;
  let replicaOk = false;
  let record: { total: number; wins: number; losses: number; wr: number } = {
    total: 0,
    wins: 0,
    losses: 0,
    wr: 0,
  };
  let blocked = false;
  let blockReason: string | null = null;
  try {
    const raw = await runPythonInline(code, {
      timeout: 5000,
      env: { PF_TICKER: ticker, PF_DIRECTION: direction },
    });
    const py = JSON.parse(raw);
    capital = typeof py.capital === "number" ? py.capital : 50;
    replicaMargin = typeof py.replicaMargin === "number" ? py.replicaMargin : 0;
    replicaOk = true;
    record = py.record ?? record;
    blocked = !!py.blocked;
    blockReason = py.blockReason ?? null;
  } catch {
    // Replica read failed — keep defaults; a live heartbeat margin (if present) is
    // still used below, so a DB blip never silently zeros the guard.
  }

  // Heartbeat is primary; replica is the fallback ONLY when the heartbeat is
  // unreachable (null). An empty live set ⇒ heartbeatMargin === 0 (flat account,
  // correctly 0). `?? replicaMargin` only fires on null, never on a real 0.
  const currentMargin = heartbeatMargin ?? replicaMargin;
  const marginSource =
    heartbeatMargin !== null ? "heartbeat" : replicaOk ? "replica" : "unavailable";
  const percentUsed = capital > 0 ? Math.round((currentMargin / capital) * 1000) / 10 : 0;

  return NextResponse.json({
    capital,
    currentMargin,
    percentUsed,
    marginSource,
    record,
    blocked,
    blockReason,
  });
}
