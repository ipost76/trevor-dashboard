"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, CollapsibleSection, MetricTile, Pill, Skeleton, EmptyState } from "@/components/ui";
import { Layers } from "lucide-react";
import { plainReaderError } from "@/lib/plain-labels";
import { ShadowTableCard, type ShadowTableInfo } from "./shadow-table-card";

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
  tables?: ShadowTableInfo[];
  /** A stable code (B13) — the English lives in `plainReaderError()`. */
  error_code?: string;
  /** Legacy failure SIGNAL only; its value is never rendered. See promotions-list. */
  error?: unknown;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

const GRID_CLASS = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

export function ShadowSection() {
  const [data, setData] = React.useState<ShadowResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/intel/shadow", { cache: "no-store" });
        if (res.ok && !cancelled) setData(await res.json());
      } catch {
        // Network errors are swallowed — keep last-good snapshot on screen.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const intervalId = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  // 🚨 The Intel zone's LANDING tab — the whole failure surface for this view.
  // Must always NAME a failure; never silence, never a false empty state.
  if (data?.error_code || data?.error) {
    return (
      <div className="p-4 md:p-6 lg:px-8 animate-fade-in">
        <EmptyState title="Failed" body={plainReaderError(data.error_code)} />
      </div>
    );
  }

  const shadow = data?.shadow;
  const shadowProgress = shadow
    ? shadow.rows / Math.max(1, shadow.rows_required_for_analysis)
    : 0;

  const tables = data?.tables ?? [];
  const active = tables.filter((t) => t.status === "ACTIVE");
  const broken = tables.filter((t) => t.status === "BROKEN" || t.status === "STALE");
  const dormant = tables.filter((t) => t.status === "DORMANT");
  const tablesLoading = loading && tables.length === 0;

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

      {/* All other shadow tables */}
      {tablesLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          {active.length > 0 && (
            <section aria-labelledby="shadow-active-heading">
              <header className="mb-3 flex items-center justify-between gap-2">
                <h3
                  id="shadow-active-heading"
                  className="font-sans text-h3 font-semibold uppercase tracking-[0.15em] text-fg-primary"
                >
                  Active Shadows
                </h3>
                <Pill intent="active" size="sm">{active.length}</Pill>
              </header>
              <div className={GRID_CLASS}>
                {active.map((t) => (
                  <ShadowTableCard key={t.table_name} info={t} />
                ))}
              </div>
            </section>
          )}

          {broken.length > 0 && (
            <section aria-labelledby="shadow-broken-heading">
              <header className="mb-3 flex items-center justify-between gap-2">
                <h3
                  id="shadow-broken-heading"
                  className="font-sans text-h3 font-semibold uppercase tracking-[0.15em] text-accent-red"
                >
                  Broken
                </h3>
                <Pill intent="error" size="sm">{broken.length}</Pill>
              </header>
              <div className={GRID_CLASS}>
                {broken.map((t) => (
                  <ShadowTableCard key={t.table_name} info={t} />
                ))}
              </div>
            </section>
          )}

          {dormant.length > 0 && (
            <CollapsibleSection
              title={`Dormant Shadows (${dormant.length})`}
              defaultOpen={false}
              rightSlot={<Pill tone="neutral" size="sm">{dormant.length}</Pill>}
            >
              <div className={`${GRID_CLASS} p-4`}>
                {dormant.map((t) => (
                  <ShadowTableCard key={t.table_name} info={t} />
                ))}
              </div>
            </CollapsibleSection>
          )}

          {!tablesLoading && tables.length === 0 && (
            <EmptyState
              title="No shadow tables"
              body="The inventory query returned no rows."
            />
          )}
        </>
      )}
    </div>
  );
}
