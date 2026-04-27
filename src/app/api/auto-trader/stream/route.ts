import { runPython, safeJsonParse } from "@/lib/api-helpers";

// SSE endpoint for the Auto Trader page (P1 overhaul, 2026-04-23).
//
// Emits two event types every 30s:
//   event: positions   data: { positions: [...], timestamp }
//   event: summary     data: { enabled, equity, starting_capital, pnl_total, ... }
//
// Data source: query_auto_trader_live.py (READ-ONLY SQLite) + Hyperliquid
// allMids for live prices. Live P&L computed in Node using the executor's
// formula. A 5s module-level cache coalesces ticks when multiple clients
// are subscribed so we don't spawn N Python processes per tick.
//
// Auth: middleware rejects /api/* without a session cookie.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Position = Record<string, unknown> & {
  ticker: string;
  direction: string;
  entry_price: number;
  stop_price: number;
  leverage: number;
  notional_usd: number;
  opened_at: string;
  trade_mode?: string;
};

type Summary = {
  enabled: boolean;
  mode: "live" | "paper";
  equity: number;
  equity_source: "hyperliquid" | "simulated";
  starting_capital: number;
  pnl_total: number;
  today_pnl: number;
  today_count: number;
  open_count: number;
  open_notional: number;
  trades_today: number;
  max_daily: number;
  last_trade_at: string | null;
  consecutive_losses: number;
  sdk_errors: number;
  live_hard_cap: number;
  stats_7d: { total_trades: number; wins: number; losses: number; win_rate: number; total_pnl: number };
};

type Cached = { positions: Record<string, unknown>[]; summary: Summary; ts: number };
let sharedCache: Cached | null = null;
const CACHE_TTL_MS = 5_000;
// 2026-04-26: hero requested 15s push cadence for premium live feel.
const TICK_MS = 15_000;

async function fetchHyperliquidMids(): Promise<Record<string, number>> {
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as Record<string, string>;
    const prices: Record<string, number> = {};
    for (const [sym, val] of Object.entries(data)) {
      const n = parseFloat(val);
      if (!isNaN(n) && n > 0) prices[sym] = n;
    }
    return prices;
  } catch {
    return {};
  }
}

function fmtHold(mins: number): string {
  if (!isFinite(mins) || mins < 0) mins = 0;
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function computeLivePnl(entry: number, current: number, direction: string, leverage: number): number {
  if (!entry || !current) return 0;
  const raw = direction === "SHORT" ? (entry - current) / entry : (current - entry) / entry;
  return raw * 100 * (leverage || 1);
}

async function buildTick(): Promise<{ positions: Record<string, unknown>[]; summary: Summary }> {
  const raw = runPython("query_auto_trader_live.py", [], { timeout: 10_000 });
  const snap = safeJsonParse<{
    enabled: boolean;
    mode?: string;
    equity: number;
    starting_capital: number;
    open_positions: Position[];
    stats_7d: Summary["stats_7d"];
    trades_today: number;
    today_pnl?: number;
    today_count?: number;
    open_notional?: number;
    last_trade_at?: string | null;
    consecutive_losses?: number;
    sdk_errors?: number;
    live_hard_cap?: number;
    config: Record<string, string>;
  }>(raw, {
    enabled: false,
    mode: "paper",
    equity: 0,
    starting_capital: 50,
    open_positions: [],
    stats_7d: { total_trades: 0, wins: 0, losses: 0, win_rate: 0, total_pnl: 0 },
    trades_today: 0,
    today_pnl: 0,
    today_count: 0,
    open_notional: 0,
    last_trade_at: null,
    consecutive_losses: 0,
    sdk_errors: 0,
    live_hard_cap: 50,
    config: {},
  });

  const openPositions = Array.isArray(snap.open_positions) ? snap.open_positions : [];
  const tickers = Array.from(
    new Set(openPositions.map((p) => String(p.ticker || "").toUpperCase()))
  );
  const mids = tickers.length > 0 ? await fetchHyperliquidMids() : {};

  const now = Date.now();
  const positions = openPositions.map((p) => {
    const ticker = String(p.ticker || "").toUpperCase();
    const current = mids[ticker] ?? null;

    const entry = Number(p.entry_price || 0);
    const stop = Number(p.stop_price || 0);
    const leverage = Number(p.leverage || 1);
    const direction = String(p.direction || "LONG").toUpperCase();
    const notional = Number(p.notional_usd || 0);
    const openedAt = String(p.opened_at || "");

    const livePnlPct = current != null ? computeLivePnl(entry, current, direction, leverage) : 0;
    const livePnlUsd = notional * (livePnlPct / 100);

    const stopDistPct = entry > 0 ? (Math.abs(entry - stop) / entry) * 100 * leverage : 0;
    const rMultiple = stopDistPct > 0 ? livePnlPct / stopDistPct : 0;

    // SQLite stores UTC as "YYYY-MM-DD HH:MM:SS" — coerce to ISO and Date.parse
    const iso = openedAt.includes("T") ? openedAt : openedAt.replace(" ", "T") + "Z";
    const opened = Date.parse(iso);
    const holdMinutes = isFinite(opened) ? Math.max(0, (now - opened) / 60000) : 0;

    return {
      ...p,
      current_price: current,
      price_source: current != null ? "hyperliquid" : "none",
      price_stale: current == null,
      live_pnl_pct: Math.round(livePnlPct * 1000) / 1000,
      live_pnl_usd: Math.round(livePnlUsd * 10000) / 10000,
      r_multiple: Math.round(rMultiple * 100) / 100,
      hold_minutes: Math.round(holdMinutes),
      hold_display: fmtHold(holdMinutes),
    };
  });

  const equity = Number(snap.equity || 0);
  const starting = Number(snap.starting_capital || 50);
  const mode: "live" | "paper" = snap.mode === "live" ? "live" : "paper";
  const isLive = mode === "live";

  // 2026-04-27: max_concurrent removed (Aggressive Mode Sweep — no concurrent cap).
  // Daily cap also removed by the sweep but max_daily field kept here for now.
  const maxDaily = isLive
    ? Number(snap.config?.LIVE_MAX_DAILY_TRADES ?? 10)
    : Number(snap.config?.MAX_TRADES_PER_DAY ?? 15);

  const openNotional =
    snap.open_notional != null
      ? Number(snap.open_notional)
      : positions.reduce((acc, p) => acc + Number(p.notional_usd || 0), 0);

  const summary: Summary = {
    enabled: !!snap.enabled,
    mode,
    equity,
    equity_source: isLive ? "hyperliquid" : "simulated",
    starting_capital: starting,
    pnl_total: Math.round((equity - starting) * 10000) / 10000,
    today_pnl: Math.round(Number(snap.today_pnl ?? 0) * 10000) / 10000,
    today_count: Number(snap.today_count ?? 0),
    open_count: positions.length,
    open_notional: Math.round(openNotional * 100) / 100,
    trades_today: Number(snap.trades_today || 0),
    max_daily: maxDaily,
    last_trade_at: snap.last_trade_at ?? null,
    consecutive_losses: Number(snap.consecutive_losses ?? 0),
    sdk_errors: Number(snap.sdk_errors ?? 0),
    live_hard_cap: Number(snap.live_hard_cap ?? 50),
    stats_7d: snap.stats_7d || { total_trades: 0, wins: 0, losses: 0, win_rate: 0, total_pnl: 0 },
  };

  return { positions, summary };
}

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      const tick = async () => {
        if (closed) return;
        try {
          let payload: { positions: Record<string, unknown>[]; summary: Summary };
          if (sharedCache && Date.now() - sharedCache.ts < CACHE_TTL_MS) {
            payload = { positions: sharedCache.positions, summary: sharedCache.summary };
          } else {
            payload = await buildTick();
            sharedCache = { ...payload, ts: Date.now() };
          }
          send("positions", { positions: payload.positions, timestamp: new Date().toISOString() });
          send("summary", payload.summary);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          send("error", { message: msg });
        }
      };

      // heartbeat comment every 15s keeps intermediate proxies from closing idle connections
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          closed = true;
        }
      }, 15_000);

      await tick();
      const interval = setInterval(tick, TICK_MS);

      const abort = () => {
        closed = true;
        clearInterval(interval);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", abort);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
