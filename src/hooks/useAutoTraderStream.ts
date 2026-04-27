"use client";

import { useEffect, useRef, useState } from "react";

export type AutoTraderPosition = {
  id: number;
  ticker: string;
  direction: string;
  entry_price: number;
  stop_price: number;
  target_price: number;
  leverage: number;
  notional_usd: number;
  original_notional_usd: number | null;
  confidence: number;
  adjusted_confidence: number | null;
  peak_pnl_pct: number;
  peak_price: number | null;
  trough_price: number | null;
  partial_exits_taken: number;
  partial_pnl_realized: number;
  breakeven_stop_active: boolean;
  opened_at: string;
  regime_at_entry: string | null;
  market_state: string | null;
  trade_mode: "live" | "paper";

  // enriched server-side:
  current_price: number | null;
  price_source: string;
  price_stale: boolean;
  live_pnl_pct: number;
  live_pnl_usd: number;
  r_multiple: number;
  hold_minutes: number;
  hold_display: string;
};

export type AutoTraderSummary = {
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
  stats_7d: {
    total_trades: number;
    wins: number;
    losses: number;
    win_rate: number;
    total_pnl: number;
  };
};

type ConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

export function useAutoTraderStream() {
  const [positions, setPositions] = useState<AutoTraderPosition[]>([]);
  const [summary, setSummary] = useState<AutoTraderSummary | null>(null);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    const es = new EventSource("/api/auto-trader/stream");
    esRef.current = es;

    es.onopen = () => {
      if (!cancelled) setState("connected");
    };
    es.onerror = () => {
      // EventSource auto-reconnects; we surface this as "reconnecting"
      if (!cancelled) setState("reconnecting");
    };

    es.addEventListener("positions", (e) => {
      if (cancelled) return;
      try {
        const data = JSON.parse((e as MessageEvent).data);
        if (Array.isArray(data?.positions)) {
          setPositions(data.positions);
          setLastUpdate(Date.now());
          setState("connected");
        }
      } catch {
        /* swallow parse errors */
      }
    });

    es.addEventListener("summary", (e) => {
      if (cancelled) return;
      try {
        const data = JSON.parse((e as MessageEvent).data);
        setSummary(data);
        setState("connected");
      } catch {
        /* swallow */
      }
    });

    es.addEventListener("error", (e) => {
      // server-side logical error event (distinct from network error)
      if (cancelled) return;
      try {
        const data = JSON.parse((e as MessageEvent).data);
        // Keep old data visible; flag connection as reconnecting so UI dims
        if (data?.message) setState("reconnecting");
      } catch {
        /* swallow */
      }
    });

    return () => {
      cancelled = true;
      try {
        es.close();
      } catch {
        /* already closed */
      }
      esRef.current = null;
    };
  }, []);

  return { positions, summary, state, lastUpdate };
}
