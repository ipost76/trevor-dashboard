"use client";
import * as React from "react";
import { Card, Pill, KillswitchPill } from "@/components/ui";
import { Bot } from "lucide-react";

interface AutoState {
  auto_enabled: boolean;
  live_enabled: boolean;
}

type StatusIntent = "live" | "warn" | "error";

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

  let intent: StatusIntent;
  let label: string;
  if (!data) {
    intent = "warn";
    label = "LOADING";
  } else if (!enabled) {
    intent = "error";
    label = "DISABLED";
  } else if (liveEnabled) {
    intent = "live";
    label = "LIVE";
  } else {
    intent = "warn";
    label = "PAPER";
  }

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
            <span className="font-sans text-micro text-fg-muted">10 tickers</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill intent={intent} size="sm">
            {label}
          </Pill>
          <KillswitchPill />
        </div>
      </div>
    </Card>
  );
}
