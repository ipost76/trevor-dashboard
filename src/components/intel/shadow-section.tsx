"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, MetricTile, Pill, Skeleton, EmptyState } from "@/components/ui";
import { Layers } from "lucide-react";

interface ShadowState {
  rows: number;
  rows_required_for_analysis: number;
  ready_for_analysis: boolean;
  last_score_at: string | null;
  model_method: string;
  last_retrain_iso: string | null;
  hmm_regime_source: string | null;
  enabled: boolean;
}

interface ShadowResponse {
  shadow: ShadowState;
  error?: string;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

export function ShadowSection() {
  const [data, setData] = React.useState<ShadowResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/intel/shadow", { cache: "no-store" });
        if (res.ok && !cancelled) setData(await res.json());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (data?.error) {
    return (
      <div className="p-4 md:p-6 lg:px-8 animate-fade-in">
        <EmptyState title="Failed" body={data.error} />
      </div>
    );
  }

  const shadow = data?.shadow;
  const shadowProgress = shadow
    ? shadow.rows / Math.max(1, shadow.rows_required_for_analysis)
    : 0;

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      {/* Shadow scoring */}
      <Card padding="md" className={shadow?.enabled === false ? "card-warn" : "card-elevated"}>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Layers size={14} />
              SHADOW SCORING
            </span>
          </CardTitle>
          {shadow ? (
            <Pill intent={shadow.enabled ? "active" : "warn"} size="sm">
              {shadow.enabled ? "ACTIVE" : "OFF"}
            </Pill>
          ) : (
            <Pill tone="neutral" size="sm">…</Pill>
          )}
        </CardHeader>

        {loading || !shadow ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricTile label="Method" value={shadow.model_method.toUpperCase()} sub="ensemble" size="sm" />
              <MetricTile
                label="Rows"
                value={shadow.rows.toLocaleString()}
                sub={`/ ${shadow.rows_required_for_analysis} req`}
                size="sm"
              />
              <MetricTile
                label="Ready?"
                value={shadow.ready_for_analysis ? "YES" : "NOT YET"}
                tone={shadow.ready_for_analysis ? "positive" : "neutral"}
                sub="for FUTURE_01"
                size="sm"
              />
              <MetricTile
                label="Last Score"
                value={fmtDate(shadow.last_score_at)}
                sub={shadow.hmm_regime_source ? `regime: ${shadow.hmm_regime_source}` : "—"}
                size="sm"
              />
            </div>

            <div className="relative h-2 mt-3 rounded-full bg-bg-elevated overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-accent-cyan-soft"
                style={{ width: `${Math.max(0, Math.min(100, shadowProgress * 100))}%` }}
              />
            </div>
            <div className="mt-1 font-sans text-micro text-fg-muted">
              {shadow.ready_for_analysis
                ? "Ready for FUTURE_01 shadow analysis."
                : `${Math.max(0, shadow.rows_required_for_analysis - shadow.rows)} more rows needed.`}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
