"use client";
import * as React from "react";
import {
  CollapsibleSection,
  EmptyState,
  Pill,
  Skeleton,
  TabBar,
  type TabBarItem,
} from "@/components/ui";
import { CompactShadowCard } from "@/components/ui/compact-shadow-card";
import { cn } from "@/lib/utils";
import { ShadowScoringHero, type IntelShadowState } from "./shadow-scoring-hero";
import { PartialShadowCard } from "@/components/autotrader-v2/partial-shadow-card";

type RegistryStatus = "ACTIVE" | "DORMANT" | "BROKEN";
type FunctionGroup = "Entry" | "Exit" | "Scoring" | "Risk" | "Data";

export interface ShadowRegistryTable {
  table_name: string;
  display: string;
  function: FunctionGroup;
  rows: number;
  rows_48h: number;
  latest_write: string | null;
  status: RegistryStatus;
  expected_active: boolean;
  error?: string;
}

interface ShadowRegistryResponse {
  tables: ShadowRegistryTable[];
  by_function: Record<string, string[]>;
  by_status: Record<string, number>;
  total: number;
  stale_days: number;
  error?: string;
}

interface IntelShadowResponse {
  shadow?: IntelShadowState;
  error?: string;
}

const FUNCTION_ORDER: ReadonlyArray<FunctionGroup> = [
  "Entry",
  "Exit",
  "Scoring",
  "Risk",
  "Data",
];

const HERO_TABLE = "shadow_scoring";

function fmtAge(iso: string | null | undefined): string {
  if (!iso) return "never";
  // SQLite emits naive UTC ("YYYY-MM-DD HH:MM:SS"); append Z so the browser
  // parses it as UTC rather than local. Matches shadow-table-card.tsx.
  const normalized = /[zZ]|[+-]\d\d:?\d\d$/.test(iso)
    ? iso.replace(" ", "T")
    : iso.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  const ageSec = (Date.now() - d.getTime()) / 1000;
  if (ageSec < 0) return "just now";
  if (ageSec < 60) return `${Math.floor(ageSec)}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  return `${Math.floor(ageSec / 86400)}d ago`;
}

function activityBorder(rows48h: number, status: RegistryStatus): string {
  if (status !== "ACTIVE" || rows48h <= 0) return "border-l-border-subtle";
  if (rows48h > 100) return "border-l-accent-cyan-soft-strong";
  if (rows48h >= 10) return "border-l-accent-cyan-soft/50";
  return "border-l-fg-faint";
}

function adaptCard(t: ShadowRegistryTable) {
  return {
    name: t.display,
    tableName: t.table_name,
    totalRows: t.rows,
    rows48h: t.rows_48h,
    latestAge: fmtAge(t.latest_write),
    status: (t.status === "ACTIVE" ? "active" : "dormant") as "active" | "dormant",
    function: t.function,
    extraMetrics: t.error ? { error: t.error } : undefined,
  };
}

interface FunctionBlockProps {
  title: FunctionGroup;
  tables: ShadowRegistryTable[];
  sortKey: "rows_48h" | "rows";
}

function FunctionBlock({ title, tables, sortKey }: FunctionBlockProps) {
  const sorted = React.useMemo(
    () =>
      [...tables].sort((a, b) => {
        if (sortKey === "rows_48h") return b.rows_48h - a.rows_48h;
        return b.rows - a.rows;
      }),
    [tables, sortKey],
  );
  if (sorted.length === 0) return null;

  // ≤5 → default open; >5 → collapsed (per Phase 1 spec).
  const defaultOpen = sorted.length <= 5;
  const intent = sorted[0].status === "ACTIVE" ? "active" : ("warn" as const);

  return (
    <CollapsibleSection
      title={title}
      defaultOpen={defaultOpen}
      rightSlot={
        <Pill intent={intent} size="sm">
          {sorted.length}
        </Pill>
      }
    >
      <div className="space-y-2 p-3">
        {sorted.map((t) => (
          <div
            key={t.table_name}
            className={cn("border-l-2 pl-2", activityBorder(t.rows_48h, t.status))}
          >
            <CompactShadowCard {...adaptCard(t)} />
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}

export function ShadowOverview() {
  const [registry, setRegistry] = React.useState<ShadowRegistryResponse | null>(null);
  const [intel, setIntel] = React.useState<IntelShadowResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState<"active" | "dormant">("active");

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [registryRes, intelRes] = await Promise.all([
          fetch("/api/shadow/registry", { cache: "no-store" }),
          fetch("/api/intel/shadow", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (registryRes.ok) setRegistry(await registryRes.json());
        if (intelRes.ok) setIntel(await intelRes.json());
      } catch {
        // network errors swallow; keep last-good snapshot
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const tables = registry?.tables ?? [];
  const heroTable = tables.find((t) => t.table_name === HERO_TABLE) ?? null;
  // Hero owns shadow_scoring — strip it from the Scoring section to avoid
  // visual duplication (Ghost decision at D4 Phase 0 gate).
  const tablesExHero = tables.filter((t) => t.table_name !== HERO_TABLE);
  const active = tablesExHero.filter((t) => t.status === "ACTIVE");
  const dormant = tablesExHero.filter(
    (t) => t.status === "DORMANT" || t.status === "BROKEN",
  );

  const groupByFn = (rows: ShadowRegistryTable[]) =>
    FUNCTION_ORDER.map((fn) => ({
      fn,
      rows: rows.filter((r) => r.function === fn),
    }));

  const activeGroups = groupByFn(active);
  const dormantGroups = groupByFn(dormant);

  const items: ReadonlyArray<TabBarItem<"active" | "dormant">> = [
    { key: "active", label: `Active (${active.length + (heroTable ? 1 : 0)})` },
    { key: "dormant", label: `Dormant (${dormant.length})` },
  ];

  if (registry?.error) {
    return (
      <div className="p-4 md:p-6 lg:px-8">
        <EmptyState title="Failed" body={registry.error} />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <TabBar items={items} active={tab} onChange={setTab} />

      {loading && tables.length === 0 ? (
        <Skeleton className="h-48 w-full" />
      ) : tab === "active" ? (
        <div className="space-y-4">
          <ShadowScoringHero
            registry={heroTable}
            intel={intel?.shadow ?? null}
            loading={loading && !registry}
          />
          <PartialShadowCard />
          {activeGroups.map(({ fn, rows }) =>
            rows.length === 0 ? null : (
              <FunctionBlock key={fn} title={fn} tables={rows} sortKey="rows_48h" />
            ),
          )}
          {active.length === 0 && !heroTable && (
            <EmptyState
              title="No active shadows"
              body="The registry returned no ACTIVE rows."
            />
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {dormantGroups.map(({ fn, rows }) =>
            rows.length === 0 ? null : (
              <FunctionBlock key={fn} title={fn} tables={rows} sortKey="rows" />
            ),
          )}
          {dormant.length === 0 && (
            <EmptyState
              title="No dormant shadows"
              body="Every tracked shadow is currently active."
            />
          )}
        </div>
      )}
    </div>
  );
}
