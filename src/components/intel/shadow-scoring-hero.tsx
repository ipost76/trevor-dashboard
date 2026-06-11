"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, MetricTile, Pill, Skeleton } from "@/components/ui";
import { Layers, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShadowRegistryTable } from "./shadow-overview";

export interface IntelShadowState {
  rows: number;
  rows_required_for_analysis: number;
  ready_for_analysis: boolean;
  last_score_at: string | null;
  model_method: string;
  last_retrain_iso: string | null;
  hmm_regime_source: string | null;
  enabled: boolean;
}

interface ShadowScoringHeroProps {
  registry: ShadowRegistryTable | null;
  intel: IntelShadowState | null;
  loading: boolean;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

export function ShadowScoringHero({ registry, intel, loading }: ShadowScoringHeroProps) {
  const [expanded, setExpanded] = React.useState(false);
  const enabled = intel?.enabled ?? true;
  const cardClass = enabled === false ? "card-warn" : "card-elevated";

  if (loading && !registry && !intel) {
    return (
      <Card padding="md" className="card-elevated border-accent-cyan-soft/40">
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }

  const method = intel?.model_method?.toUpperCase() ?? "HMM+DS";
  const rows = intel?.rows ?? registry?.rows ?? 0;
  const required = intel?.rows_required_for_analysis ?? 0;
  const progress = required > 0 ? rows / required : 1;
  const ready = intel?.ready_for_analysis ?? rows >= required;
  const lastScore = intel?.last_score_at ?? registry?.latest_write ?? null;
  const regimeSource = intel?.hmm_regime_source ?? null;

  return (
    <Card padding="md" className={`${cardClass} border-l-4 border-l-accent-cyan-soft-strong`}>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            <Layers size={16} className="text-accent-cyan-soft-strong" />
            <span className="font-sans font-bold uppercase tracking-[0.15em]">
              Shadow Scoring
            </span>
            <span className="font-sans text-micro font-normal normal-case tracking-normal text-fg-muted">
              · core HMM+DS pipeline
            </span>
          </span>
        </CardTitle>
        <Pill intent={enabled ? "active" : "warn"} size="sm">
          {enabled ? "ACTIVE" : "OFF"}
        </Pill>
      </CardHeader>

      {/* HUB-C2 default: ONE aggregate summary line (tap to expand). This is the
          HMM+DS pipeline meta-card — a readiness rollup, not a per-trade outcome
          shadow, so no win-rate is shown (none would be honest). */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
        className="tap-target flex w-full items-start gap-2 text-left"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-caption tabular-nums text-fg-muted">
          <span>{method}</span>
          <span className="text-fg-faint">·</span>
          <span>
            {rows.toLocaleString()}
            {required > 0 ? ` / ${required.toLocaleString()} req` : " rows"}
          </span>
          <span className="text-fg-faint">·</span>
          <span className={ready ? "text-accent-mint-strong" : "text-fg-muted"}>
            {ready ? "ready" : "not yet"}
          </span>
          <span className="text-fg-faint">·</span>
          <span className="text-fg-faint">last {fmtDate(lastScore)}</span>
        </div>
        <ChevronDown
          size={16}
          aria-hidden
          className={cn(
            "mt-0.5 shrink-0 text-fg-muted transition-transform duration-fast",
            expanded ? "rotate-180" : "rotate-0",
          )}
        />
      </button>

      {expanded && (
        <div className="mt-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricTile label="Method" value={method} sub="ensemble" size="sm" />
            <MetricTile
              label="Rows"
              value={rows.toLocaleString()}
              sub={required > 0 ? `/ ${required.toLocaleString()} req` : "total"}
              size="sm"
            />
            <MetricTile
              label="Ready?"
              value={ready ? "YES" : "NOT YET"}
              tone={ready ? "positive" : "neutral"}
              sub="for FUTURE_01"
              size="sm"
            />
            <MetricTile
              label="Last Score"
              value={fmtDate(lastScore)}
              sub={regimeSource ? `regime: ${regimeSource}` : "—"}
              size="sm"
            />
          </div>

          {required > 0 && (
            <>
              <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-bg-elevated">
                <div
                  className="absolute inset-y-0 left-0 bg-accent-cyan-soft-strong"
                  style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
                />
              </div>
              <div className="mt-1 font-sans text-micro text-fg-muted">
                {ready
                  ? "Ready for FUTURE_01 shadow analysis."
                  : `${Math.max(0, required - rows).toLocaleString()} more rows needed.`}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
