"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, MetricTile, Pill, Skeleton, EmptyState } from "@/components/ui";
import { Layers, FlaskConical } from "lucide-react";

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

interface OptunaABParamsSnapshot {
  n_trials?: number | null;
  n_simulated_trades?: number | null;
  n_trades_evaluated?: number | null;
  win_rate?: number | null;
  sharpe_ratio?: number | null;
  total_pnl?: number | null;
  max_drawdown?: number | null;
  confidence_floor?: number | null;
}

interface OptunaABState {
  present: boolean;
  enabled?: boolean;
  started_at?: string | null;
  stopped_at?: string | null;
  params_generated_at?: string | null;
  total_comparisons?: number;
  prod_fires_count?: number;
  optuna_fires_count?: number;
  disagreements_count?: number;
  disagreement_rate_pct?: number;
  last_enabled_by?: string | null;
  last_reason?: string | null;
  params_snapshot?: OptunaABParamsSnapshot | null;
}

interface ShadowResponse {
  shadow: ShadowState;
  optuna_ab: OptunaABState;
  error?: string;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  return Math.floor((Date.now() - d) / 86_400_000);
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
  const ab = data?.optuna_ab;
  const shadowProgress = shadow
    ? shadow.rows / Math.max(1, shadow.rows_required_for_analysis)
    : 0;
  const abActive = !!(ab?.present && ab.enabled && !ab.stopped_at);
  const reviewWindowDays = ab?.started_at ? daysSince(ab.started_at) : null;
  const reviewOverdue = reviewWindowDays !== null && reviewWindowDays >= 14;

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

      {/* Optuna A/B comparison window */}
      <Card
        padding="md"
        className={
          abActive ? (reviewOverdue ? "card-warn" : "card-elevated") : "card-base"
        }
      >
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <FlaskConical size={14} />
              OPTUNA A/B WINDOW
            </span>
          </CardTitle>
          {ab ? (
            <Pill
              intent={abActive ? (reviewOverdue ? "warn" : "active") : undefined}
              tone={abActive ? undefined : "neutral"}
              size="sm"
            >
              {abActive ? (reviewOverdue ? "REVIEW OVERDUE" : "ACTIVE") : ab.stopped_at ? "STOPPED" : "INACTIVE"}
            </Pill>
          ) : (
            <Pill tone="neutral" size="sm">…</Pill>
          )}
        </CardHeader>

        {loading || !ab ? (
          <Skeleton className="h-32 w-full" />
        ) : !ab.present ? (
          <EmptyState title="No A/B window" body="optuna_shadow_config has no row." />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricTile
                label="Comparisons"
                value={(ab.total_comparisons ?? 0).toLocaleString()}
                sub={`prod ${ab.prod_fires_count ?? 0} / opt ${ab.optuna_fires_count ?? 0}`}
                size="sm"
              />
              <MetricTile
                label="Disagreements"
                value={(ab.disagreements_count ?? 0).toLocaleString()}
                sub={`${(ab.disagreement_rate_pct ?? 0).toFixed(1)}%`}
                tone={(ab.disagreement_rate_pct ?? 0) > 25 ? "warn" : "neutral"}
                size="sm"
              />
              <MetricTile
                label="Started"
                value={fmtDate(ab.started_at)}
                sub={
                  reviewWindowDays !== null
                    ? `${reviewWindowDays}d ago`
                    : "—"
                }
                size="sm"
              />
              <MetricTile
                label="Params From"
                value={fmtDate(ab.params_generated_at)}
                sub={ab.params_snapshot?.n_trials != null ? `n_trials=${ab.params_snapshot.n_trials}` : "—"}
                size="sm"
              />
            </div>

            {ab.params_snapshot && (
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 text-caption">
                {ab.params_snapshot.confidence_floor != null && (
                  <SnapStat label="Conf Floor" value={ab.params_snapshot.confidence_floor.toString()} />
                )}
                {ab.params_snapshot.win_rate != null && (
                  <SnapStat label="Train WR" value={`${ab.params_snapshot.win_rate.toFixed(1)}%`} />
                )}
                {ab.params_snapshot.sharpe_ratio != null && (
                  <SnapStat label="Sharpe" value={ab.params_snapshot.sharpe_ratio.toFixed(2)} />
                )}
                {ab.params_snapshot.total_pnl != null && (
                  <SnapStat label="Train PnL" value={`${ab.params_snapshot.total_pnl.toFixed(2)}%`} />
                )}
              </div>
            )}

            {ab.last_reason && (
              <div className="mt-3 rounded-md border border-border-subtle bg-bg-elevated p-2 font-sans text-micro text-fg-muted">
                <span className="font-semibold text-fg-primary">Reason:</span> {ab.last_reason}
                {ab.last_enabled_by && <> · <span className="font-semibold">{ab.last_enabled_by}</span></>}
              </div>
            )}

            {reviewOverdue && (
              <div className="mt-3 rounded-md border border-accent-gold/40 bg-accent-gold/10 p-2 font-sans text-micro text-accent-gold-strong">
                Review window passed (started {reviewWindowDays}d ago).
                Decide: roll forward, freeze, or revert prod params.
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function SnapStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border-subtle bg-bg-elevated px-2 py-1">
      <span className="font-sans text-fg-muted text-micro uppercase tracking-wider">{label}</span>
      <span className="font-mono font-semibold tabular-nums">{value}</span>
    </div>
  );
}
