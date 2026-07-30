"use client";
import * as React from "react";
import { Card, Pill, KillswitchPill } from "@/components/ui";
import {
  normalizePaperWindowState,
  resolveModeBadge,
  configuredDisagrees,
  type PaperWindowState,
} from "@/lib/trading-mode";
import { Bot } from "lucide-react";

// 🚨 W4a (2026-07-30) — THE MODE BADGE DERIVES FROM THE GATE, NEVER FROM CONFIG.
//
// This badge rendered `LIVE` for the whole v5 paper window: it read
// `live_enabled` (auto_config AUTO_LIVE_ENABLED), which is the CONFIGURED
// execution flag and gates NOTHING on the bot. The load-bearing gate is
// `PAPER_WINDOW_ENABLED` — auto_trader/config.py:398 calls it "the load-bearing
// boundary gate for the v5 cutover" and live_executor._paper_window_on()
// branches on it. Same defect class as RP-V2's finding V2-1 on the VM
// (discord_bot.py renders `Mode: {config.TRADING_MODE}` with no paper consult).
// Two surfaces, one root cause: nothing in either codebase distinguished the
// CONFIGURED mode from the EFFECTIVE one.
//
// The switch is AUTOMATIC and there is deliberately NO TOGGLE: because the badge
// derives from the gate, closing the paper window flips this by itself. A manual
// toggle would be one more surface that can disagree with reality.
interface AutoState {
  auto_enabled: boolean;
  /** CONFIGURED only — gates nothing. 🚨 Never drive the badge from this. */
  live_enabled: boolean;
  /** EFFECTIVE mode. See src/lib/trading-mode.ts for the four states. */
  paper_window_state?: PaperWindowState;
}

export function ScalperHeader() {
  const [data, setData] = React.useState<AutoState | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const fetchState = async () => {
      try {
        const res = await fetch("/api/auto/state", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as AutoState;
        if (!cancelled) setData(j);
      } catch {
        /* keep last good state */
      }
    };
    fetchState();
    const id = setInterval(fetchState, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // 🚨 The badge is NOT decided here. It is decided by src/lib/trading-mode.ts,
  // the single authority every mode-rendering surface shares — so a fix to the
  // fail direction can never land on one surface and miss another. This
  // component only renders what that module returns.
  const pwState = normalizePaperWindowState(data?.paper_window_state);
  const { label, intent, detail } = resolveModeBadge({
    hasData: data !== null,
    autoEnabled: data?.auto_enabled === true,
    state: pwState,
  });
  const showConfiguredSplit = configuredDisagrees({
    liveEnabled: data?.live_enabled === true,
    state: pwState,
  });

  const iconCls =
    intent === "live"
      ? "text-accent-mint"
      : intent === "error"
      ? "text-accent-red"
      : "text-accent-gold";

  return (
    <Card padding="md" className="card-elevated">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Bot size={18} className={iconCls} aria-hidden />
          <div className="flex flex-col">
            <span className="font-sans text-h3 font-semibold tracking-tight text-fg-primary">
              AUTOTRADER
            </span>
            <span className="font-sans text-micro text-fg-muted">
              10 tickers · {detail}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill intent={intent} size="sm">
            {label}
          </Pill>
          <KillswitchPill />
        </div>
      </div>

      {/* W4a: the configured-vs-effective split, surfaced only on disagreement.
          This is the exact state that shipped the false LIVE badge. */}
      {showConfiguredSplit && (
        <p className="mt-2 font-sans text-micro text-fg-muted">
          <span className="text-accent-gold">Configured</span> AUTO_LIVE_ENABLED=true ·{" "}
          <span className="text-accent-gold">Effective</span> mode is{" "}
          {label === "PAPER?" ? "unconfirmed" : "paper"} — the paper window is
          what the bot gates on.
        </p>
      )}
    </Card>
  );
}
