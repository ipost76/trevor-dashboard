"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, MetricTile, Pill, HapticButton } from "@/components/ui";
import { Skull, Bot, Zap, Target, AlertTriangle } from "lucide-react";
import Link from "next/link";

/**
 * DEGEN sub-tab — pre-launch state.
 *
 * DEGEN is a separate AutoTrader bot for higher-risk setups across the wider
 * Hyperliquid ticker universe. It does NOT exist yet (audit Phase 3.10
 * confirmed UI-only state). This component renders an honest waitlist surface
 * — never invents metrics or PnL data.
 *
 * When DEGEN ships (Wave J), this file is replaced with a real renderer.
 */
export function DegenSection() {
  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      {/* Hero — magenta accent, no fake number */}
      <Card padding="lg" glow="magenta" className="space-y-4 text-center md:text-left">
        <div className="flex flex-col items-center gap-3 md:flex-row md:gap-4">
          <div className="rounded-full border border-accent-magenta/40 bg-accent-magenta/10 p-3">
            <Skull size={28} className="text-accent-magenta" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-center gap-2 md:justify-start">
              <span className="text-micro text-fg-muted">DEGEN MODE</span>
              <Pill tone="magenta" size="sm">PRE-LAUNCH</Pill>
            </div>
            <h2 className="text-h1 text-fg-primary">Coming Soon</h2>
            <p className="max-w-md text-caption text-fg-muted">
              A separate AutoTrader for higher-risk setups across the wider
              Hyperliquid universe. No data yet — bot has not been deployed.
            </p>
          </div>
        </div>
      </Card>

      {/* What it will be */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Bot size={14} />
              WHAT DEGEN WILL DO
            </span>
          </CardTitle>
        </CardHeader>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <DegenFeatureTile
            icon={<Target size={14} className="text-accent-magenta" />}
            title="Wider Universe"
            body="All Hyperliquid perps, not just BTC/ETH/SOL/HYPE/FARTCOIN."
          />
          <DegenFeatureTile
            icon={<Zap size={14} className="text-accent-amber" />}
            title="Aggressive Sizing"
            body="Higher leverage caps + relaxed confidence floors than Scalper."
          />
          <DegenFeatureTile
            icon={<AlertTriangle size={14} className="text-accent-red" />}
            title="Separate Capital Pool"
            body="Independent capital cap. Won't drain Scalper's $50 floor."
          />
          <DegenFeatureTile
            icon={<Skull size={14} className="text-accent-magenta" />}
            title="Independent Service"
            body="Own systemd unit, own DB rows, own killswitch path."
          />
        </ul>
      </Card>

      {/* Honest empty stats */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>Stats</CardTitle>
          <Pill tone="neutral" size="sm">N/A</Pill>
        </CardHeader>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricTile label="Capital" value="—" sub="not yet allocated" />
          <MetricTile label="Trades" value="—" sub="0 lifetime" />
          <MetricTile label="P&L" value="—" sub="bot offline" />
          <MetricTile label="Status" value="OFFLINE" tone="warn" sub="pre-launch" />
        </div>
      </Card>

      {/* Footer — links and disclaimer */}
      <Card padding="md" className="space-y-2">
        <p className="text-caption text-fg-muted">
          DEGEN deployment lives in Wave J of the Hub redesign sprint. Until it
          ships, this slot stays empty by design — TREVOR never invents metrics
          for systems that aren't running.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/autotrader?tab=scalper">
            <HapticButton variant="primary" size="sm">
              ← Back to Scalper
            </HapticButton>
          </Link>
          <Link href="/intel?tab=lessons">
            <HapticButton variant="secondary" size="sm">
              Review Scalper Lessons
            </HapticButton>
          </Link>
        </div>
      </Card>
    </div>
  );
}

function DegenFeatureTile({
  icon, title, body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-bg-elevated p-3">
      <div className="flex items-center gap-1.5 text-micro text-fg-muted">
        {icon}
        <span>{title}</span>
      </div>
      <p className="text-caption text-fg-primary">{body}</p>
    </li>
  );
}
