"use client";

import { Suspense, useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Building2,
  Compass,
  FileText,
  Search,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Card,
  EmptyState,
  Pill,
  SegmentedToggle,
  Skeleton,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { useScoutFetch } from "./use-fetch";
import { formatDateOnly, formatMcap, formatScore, rsColor } from "./format";

interface Discovery {
  id: number;
  ticker: string;
  engine: "position" | "swing";
  company_name: string | null;
  score: number;
  market_cap: number | null;
  sector: string | null;
  rs_percentile: number;
  price: number;
  trend_status: string | null;
  volume_ratio: number;
  factors: Record<string, number>;
  narrative: string | null;
  narrative_method: string | null;
  material_change_trigger: string | null;
  posted_at: string | null;
}

interface DiscoveriesResponse {
  discoveries: Discovery[];
  count: number;
}

type EngineFilter = "all" | "position" | "swing";
type DaysFilter = "7" | "14" | "30";

const ENGINE_OPTIONS: ReadonlyArray<{ value: EngineFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "position", label: "Long-term" },
  { value: "swing", label: "Swing" },
];

const DAYS_OPTIONS: ReadonlyArray<{ value: DaysFilter; label: string }> = [
  { value: "7", label: "7d" },
  { value: "14", label: "14d" },
  { value: "30", label: "30d" },
];

const VALID_ENGINES = new Set<EngineFilter>(["all", "position", "swing"]);
const VALID_DAYS = new Set<DaysFilter>(["7", "14", "30"]);

const TRIGGER_LABEL: Record<string, string> = {
  new_8k_filing: "New SEC filing",
  insider_cluster: "Insider buying cluster",
  new_stake_alert: "New institutional stake",
  new_52wk_high: "New 52-week high",
};

const TRIGGER_ICON: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  new_8k_filing: FileText,
  insider_cluster: Users,
  new_stake_alert: Building2,
  new_52wk_high: TrendingUp,
};

async function fetchDiscoveries(
  engine: EngineFilter,
  days: DaysFilter,
  signal: AbortSignal,
): Promise<DiscoveriesResponse> {
  const params = new URLSearchParams({ engine, days });
  const res = await fetch(`/api/scout/discoveries?${params.toString()}`, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `SCOUT /discoveries → HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
  }
  return res.json() as Promise<DiscoveriesResponse>;
}

function formatPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return "—";
  return `$${price.toFixed(2)}`;
}

function trendShort(trend: string | null | undefined): string {
  if (!trend) return "—";
  const lower = trend.toLowerCase();
  if (lower.includes("stage 2")) return "Stage 2 ↑";
  if (lower.includes("stage 4") || lower.includes("downtrend")) return "Stage 4 ↓";
  if (lower.includes("stage 3")) return "Stage 3 ⇣";
  if (lower.includes("stage 1") || lower.includes("base")) return "Stage 1 →";
  return trend.length > 18 ? `${trend.slice(0, 17)}…` : trend;
}

function MetricCell({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: React.ReactNode;
  valueStyle?: React.CSSProperties;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5">
      <span
        className="truncate font-mono text-body font-semibold leading-tight text-fg-primary"
        style={valueStyle}
      >
        {value}
      </span>
      <span className="text-micro uppercase tracking-wider text-fg-muted">
        {label}
      </span>
    </div>
  );
}

function DiscoveryCard({ d }: { d: Discovery }) {
  const isPosition = d.engine === "position";
  const TriggerIcon = d.material_change_trigger
    ? TRIGGER_ICON[d.material_change_trigger]
    : undefined;
  const triggerLabel = d.material_change_trigger
    ? (TRIGGER_LABEL[d.material_change_trigger] ?? "Material change")
    : null;

  return (
    <Card
      glow={isPosition ? "cyan" : "green"}
      padding="md"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <Search
            size={14}
            className={cn(
              "shrink-0 self-center",
              isPosition ? "text-accent-cyan" : "text-accent-green",
            )}
            aria-hidden
          />
          <span className="font-mono text-h3 font-bold text-fg-primary">
            {d.ticker}
          </span>
          <span className="truncate text-caption text-fg-muted">
            — {d.company_name ?? "—"}
          </span>
        </div>
        <Pill tone={isPosition ? "cyan" : "green"} size="sm">
          {isPosition ? "Position · 1-8mo" : "Swing · 1-4wk"}
        </Pill>
      </div>

      <div className="text-micro uppercase tracking-wider text-fg-muted">
        Posted {formatDateOnly(d.posted_at)}
      </div>

      <div className="grid grid-cols-3 gap-2 border-y border-border-subtle py-2">
        <MetricCell label="Price" value={formatPrice(d.price)} />
        <MetricCell label="MCap" value={formatMcap(d.market_cap)} />
        <MetricCell label="Sector" value={d.sector ?? "—"} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MetricCell
          label="RS"
          value={d.rs_percentile}
          valueStyle={{ color: rsColor(d.rs_percentile) }}
        />
        <MetricCell label="Trend" value={trendShort(d.trend_status)} />
        <MetricCell
          label="Volume"
          value={Number.isFinite(d.volume_ratio) ? `${d.volume_ratio.toFixed(1)}x` : "—"}
        />
      </div>

      {d.narrative && (
        <p className="text-caption leading-relaxed text-fg-primary">
          {d.narrative}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-2">
        {triggerLabel ? (
          <Pill tone="amber" size="sm">
            {TriggerIcon ? (
              <TriggerIcon size={10} className="shrink-0" aria-hidden />
            ) : null}
            {triggerLabel}
          </Pill>
        ) : (
          <span className="text-micro uppercase tracking-wider text-fg-muted">
            No catalyst
          </span>
        )}
        <span className="font-mono text-micro text-fg-muted">
          Confidence{" "}
          <span className="text-fg-primary">{formatScore(d.score, 0)}</span>
        </span>
      </div>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card padding="md" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-24" />
      </div>
      <Skeleton className="h-3 w-24" />
      <div className="grid grid-cols-3 gap-2 border-y border-border-subtle py-2">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
      <Skeleton className="h-16 w-full" />
    </Card>
  );
}

function DiscoveryFeedInner() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const rawEngine = (sp.get("engine") ?? "all") as EngineFilter;
  const rawDays = (sp.get("days") ?? "7") as DaysFilter;
  const engine: EngineFilter = VALID_ENGINES.has(rawEngine) ? rawEngine : "all";
  const days: DaysFilter = VALID_DAYS.has(rawDays) ? rawDays : "7";

  const setParam = useCallback(
    (key: "engine" | "days", value: string) => {
      const params = new URLSearchParams(sp.toString());
      params.set(key, value);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [sp, pathname, router],
  );

  const state = useScoutFetch<DiscoveriesResponse>(
    (signal) => fetchDiscoveries(engine, days, signal),
    [engine, days],
  );

  const cards = useMemo(() => state.data?.discoveries ?? [], [state.data]);
  const hasData = state.data != null;

  return (
    <div className="space-y-4">
      <Card padding="md" glow="magenta">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <Compass size={18} className="text-accent-magenta" aria-hidden />
              <div className="flex flex-col">
                <span className="font-mono text-h3 font-bold tracking-wide text-fg-primary">
                  STOCK DISCOVERIES
                </span>
                <span className="text-micro uppercase tracking-wider text-fg-muted">
                  Manual · SCOUT feed
                </span>
              </div>
            </div>
            {hasData ? (
              <span className="font-mono text-micro text-fg-muted">
                {state.data!.count} result{state.data!.count === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
            <SegmentedToggle
              ariaLabel="Engine filter"
              options={ENGINE_OPTIONS}
              value={engine}
              onChange={(v) => setParam("engine", v)}
              size="sm"
            />
            <SegmentedToggle
              ariaLabel="Days filter"
              options={DAYS_OPTIONS}
              value={days}
              onChange={(v) => setParam("days", v)}
              size="sm"
            />
          </div>
        </div>
      </Card>

      {state.loading && !hasData ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : null}

      {state.error ? (
        <Card padding="md" glow="red">
          <p className="font-mono text-caption text-accent-red">
            Failed to load discoveries — {state.error}
          </p>
        </Card>
      ) : null}

      {!state.loading && hasData && cards.length === 0 ? (
        <EmptyState
          icon={<Compass size={36} />}
          title="No discoveries yet"
          body="SCOUT runs daily at 4:30 PM ET. Try widening the date range or switching engine."
        />
      ) : null}

      {cards.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {cards.map((d) => (
            <DiscoveryCard key={d.id} d={d} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DiscoveryFeed() {
  return (
    <Suspense
      fallback={
        <div className="p-4 text-caption text-fg-muted">Loading discoveries…</div>
      }
    >
      <DiscoveryFeedInner />
    </Suspense>
  );
}
