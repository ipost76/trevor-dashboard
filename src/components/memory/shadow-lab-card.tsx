"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  MetricTile,
  Pill,
  CollapsibleSection,
  CompactShadowCard,
  EmptyState,
  Skeleton,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { FlaskConical } from "lucide-react";

// B6 P4 — Shadow Lab card (READ-ONLY display).
//
// Surfaces the B6 UNIFIED shadow registry: one row per registered shadow in
// `shadow_registry`, folded with per-shadow observation aggregates from the
// single `shadow_observations` table (obs counts, divergence %, Wilson
// promotion-readiness, realized-outcome aggregate). Reads the additive
// `registered_shadows[]` key off the existing /api/shadow/registry endpoint
// (the Intel shadow-overview ignores that key; this is its only consumer).
//
// EMPTY-STATE until B7 registers the first shadow (ssl.py): the registry tables
// exist (B6) but are empty, so the endpoint returns [] and this renders a clean
// EmptyState — it NEVER errors. READ-ONLY: no promote button, no writes.
//
// Reuses CompactShadowCard / ReadinessBadge (inside it) / CollapsibleSection /
// MetricTile / Pill — no new primitives.

const ENDPOINT = "/api/shadow/registry";
const POLL_MS = 60_000; // registry changes slowly + the endpoint is a ~50-table spawn

interface RegisteredShadow {
  shadow_key: string;
  display: string;
  category: string;
  candidate_desc: string | null;
  obs_table: string;
  min_n: number;
  registry_status: string | null;
  expected_active: boolean;
  obs_total: number;
  obs_48h: number;
  latest_obs: string | null;
  divergent_n: number;
  divergence_pct: number | null;
  promotion: "ready" | "accruing" | "na";
  promotion_n: number;
  outcome_linked_n: number;
  outcome_mean_pnl: number | null;
  outcome_min_pnl: number | null;
  outcome_max_pnl: number | null;
  outcome_win_rate: number | null;
  status: "ACTIVE" | "DORMANT";
}
interface RegistryShape {
  registered_shadows?: RegisteredShadow[];
  error?: string;
}

// SQLite naive timestamps are UTC — append Z if no tz marker (matches the
// house convention in shadow-table-card.tsx / active-position-card.tsx).
function fmtAge(iso: string | null): string {
  if (!iso) return "never";
  const norm = /[zZ]|[+-]\d\d:?\d\d$/.test(iso)
    ? iso
    : iso.replace(" ", "T") + "Z";
  const t = Date.parse(norm);
  if (Number.isNaN(t)) return iso;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function ShadowLabCard() {
  const [shadows, setShadows] = React.useState<RegisteredShadow[] | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as RegistryShape;
          setShadows(data.registered_shadows ?? []);
        } else if (!cancelled) {
          setShadows([]);
        }
      } catch {
        if (!cancelled) setShadows([]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void run();
    const id = setInterval(() => void run(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const list = shadows ?? [];
  const total = list.length;
  const activeN = list.filter((s) => s.status === "ACTIVE").length;
  // RM-DECOM B5: count of shadows with a statistically significant divergence
  // (Wilson-LB>0) — NOT "promotable" (the real 7-component gate is separate).
  const divergingN = list.filter((s) => s.promotion === "ready").length;
  const obsTotal = list.reduce((a, s) => a + (s.obs_total || 0), 0);

  // Group registered shadows by category for the CollapsibleSections.
  const groups = React.useMemo(() => {
    const m = new Map<string, RegisteredShadow[]>();
    for (const s of list) {
      const k = s.category || "Other";
      const arr = m.get(k) ?? [];
      arr.push(s);
      m.set(k, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [list]);

  // RM-DECOM B5: neutral border — a mint "readiness" edge telegraphed a promotion
  // verdict this card does not have. The honest divergence count lives in the tile.
  const borderClass = "border-l-border-subtle";

  return (
    <Card padding="md" className={cn("border-l-4", borderClass)}>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2 uppercase tracking-wider">
            <FlaskConical size={14} aria-hidden />
            Shadow Lab
          </span>
        </CardTitle>
        {total > 0 && (
          <Pill tone="neutral" size="sm">
            {total} registered
          </Pill>
        )}
      </CardHeader>

      {!loaded && <Skeleton className="h-20 w-full" />}

      {loaded && total === 0 && (
        <EmptyState
          icon={<FlaskConical size={28} />}
          title="No shadows registered yet"
          body="The unified shadow registry is empty. The first shadow registers in B7 (ssl.py); this lab lights up automatically once shadow_registry carries a row."
        />
      )}

      {loaded && total > 0 && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricTile label="Registered" value={total} size="sm" />
            <MetricTile
              label="Active"
              value={activeN}
              sub="writing"
              tone={activeN > 0 ? "positive" : "neutral"}
              size="sm"
            />
            <MetricTile
              label="Diverging"
              value={divergingN}
              sub="signif."
              tone={divergingN > 0 ? "cyan" : "neutral"}
              size="sm"
            />
            <MetricTile
              label="Observations"
              value={obsTotal.toLocaleString()}
              size="sm"
            />
          </div>

          {groups.map(([cat, rows]) => (
            <CollapsibleSection
              key={cat}
              title={cat}
              defaultOpen={groups.length <= 3}
              rightSlot={
                <Pill tone="neutral" size="sm">
                  {rows.length}
                </Pill>
              }
            >
              <div className="flex flex-col gap-2 p-3">
                {rows.map((s) => (
                  <CompactShadowCard
                    key={s.shadow_key}
                    name={s.display}
                    tableName={s.obs_table || s.shadow_key}
                    totalRows={s.obs_total}
                    rows48h={s.obs_48h}
                    latestAge={fmtAge(s.latest_obs)}
                    status={s.status === "ACTIVE" ? "active" : "dormant"}
                    function={s.category}
                    divergentN={s.divergent_n}
                    divergencePct={s.divergence_pct}
                    divergenceCol="divergent"
                    promotion={s.promotion}
                    promotionN={s.promotion_n}
                    outcomeCol={s.outcome_linked_n > 0 ? "realized_pnl_usd" : null}
                    outcomeLinkedN={s.outcome_linked_n}
                    outcomeMeanPnl={s.outcome_mean_pnl}
                    outcomeMinPnl={s.outcome_min_pnl}
                    outcomeMaxPnl={s.outcome_max_pnl}
                    outcomeWinRate={s.outcome_win_rate}
                    extraMetrics={
                      s.candidate_desc ? { candidate: s.candidate_desc } : undefined
                    }
                  />
                ))}
              </div>
            </CollapsibleSection>
          ))}
        </div>
      )}
    </Card>
  );
}
