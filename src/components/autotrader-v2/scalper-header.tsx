"use client";
import * as React from "react";
import { Card, LivePulse, KillswitchPill } from "@/components/ui";
import { Bot } from "lucide-react";

interface AutoState {
  auto_enabled: boolean;
  live_enabled: boolean;
}

type Tone = "green" | "amber" | "red";

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

  const enabled = data?.auto_enabled === true;
  const liveEnabled = data?.live_enabled === true;

  let tone: Tone;
  let label: string;
  if (!data) {
    tone = "amber";
    label = "LOADING";
  } else if (!enabled) {
    tone = "red";
    label = "DISABLED";
  } else if (liveEnabled) {
    tone = "green";
    label = "LIVE";
  } else {
    tone = "amber";
    label = "PAPER";
  }

  const glow: "green" | "amber" | "red" =
    tone === "green" ? "green" : tone === "red" ? "red" : "amber";
  const iconCls =
    tone === "green"
      ? "text-accent-green"
      : tone === "red"
      ? "text-accent-red"
      : "text-accent-amber";

  return (
    <Card padding="md" glow={glow}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Bot size={18} className={iconCls} aria-hidden />
          <div className="flex flex-col">
            <span className="text-h3 font-bold tracking-wide">SCALPER</span>
            <span className="text-micro text-fg-muted">
              AutoTrader · 5 tickers
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LivePulse tone={tone} label={label} />
          <KillswitchPill />
        </div>
      </div>
    </Card>
  );
}
