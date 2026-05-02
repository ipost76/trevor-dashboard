"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  MetricTile,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui";
import { Activity, Cpu } from "lucide-react";
import { KillswitchControlCard } from "./killswitch-control-card";

type Tone = "green" | "amber" | "red";

interface ServiceEntry {
  name: string;
  status: string;
  tone: Tone;
}
interface CollectorEntry {
  key: string;
  label: string;
  status: string;
  tone: Tone;
  value: string;
  detail: string;
  as_of?: string;
}
interface SentinelEntry {
  ts: string | null;
  level: string;
  tag: string;
  message: string;
}
interface HealthResponse {
  snapshot_at: string;
  killswitch_enabled: boolean;
  services: ReadonlyArray<ServiceEntry>;
  collectors: ReadonlyArray<CollectorEntry>;
  sentinels: ReadonlyArray<SentinelEntry>;
  source: string;
  stale_seconds: number | null;
  error?: string;
}

const POLL_MS = 30_000;

function dotTone(t: Tone): string {
  if (t === "green") return "bg-accent-green shadow-glow-green";
  if (t === "amber") return "bg-accent-amber";
  return "bg-accent-red";
}

function metricTone(t: Tone): "positive" | "warn" | "negative" {
  if (t === "green") return "positive";
  if (t === "amber") return "warn";
  return "negative";
}

function pillToneForLevel(lv: string): "amber" | "red" | "magenta" {
  if (lv === "ERROR") return "red";
  if (lv === "CRITICAL") return "magenta";
  return "amber";
}

export function HealthSection() {
  const [data, setData] = React.useState<HealthResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);

  const fetchHealth = React.useCallback(async () => {
    try {
      setRefreshing(true);
      const res = await fetch("/api/memory/health", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as HealthResponse);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchHealth();
    const id = setInterval(() => void fetchHealth(), POLL_MS);
    return () => clearInterval(id);
  }, [fetchHealth]);

  if (loading && !data) {
    return (
      <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      {/* Killswitch — interactive write toggle (Hub-Only Control Doctrine,
          Rule 32 rewritten 2026-05-02). Replaces the former read-only
          banner; <KillswitchPill> in the topbar remains the read-only
          mirror that polls the same /api/killswitch endpoint. */}
      <KillswitchControlCard />

      {/* Services grid */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>Services</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {(data?.services ?? []).map((s) => (
            <div
              key={s.name}
              className="flex items-center gap-3 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2"
            >
              <span
                aria-hidden="true"
                className={"h-2.5 w-2.5 rounded-full " + dotTone(s.tone)}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-caption text-fg-primary">
                  {s.name}
                </div>
                <div className="truncate text-micro text-fg-muted">
                  {s.status}
                </div>
              </div>
            </div>
          ))}
          {(data?.services?.length ?? 0) === 0 && (
            <div className="md:col-span-3">
              <EmptyState
                icon={<Activity size={28} />}
                title="No service data"
                body="systemctl probe failed."
              />
            </div>
          )}
        </div>
      </Card>

      {/* Collectors grid */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>System Probes</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {(data?.collectors ?? []).map((c) => (
            <div
              key={c.key}
              className="rounded-md border border-border-subtle bg-bg-elevated p-3"
            >
              <MetricTile
                label={c.label}
                value={c.value}
                sub={c.detail}
                tone={metricTone(c.tone)}
                size="sm"
              />
            </div>
          ))}
          {(data?.collectors?.length ?? 0) === 0 && (
            <div className="col-span-2 md:col-span-3 lg:col-span-4">
              <EmptyState
                icon={<Cpu size={28} />}
                title="No collectors"
                body="self-probe failed to start."
              />
            </div>
          )}
        </div>
      </Card>

      {/* Sentinels list */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>Recent Sentinels</CardTitle>
        </CardHeader>
        <div className="text-micro text-fg-muted mb-3">
          Last {data?.sentinels?.length ?? 0} WARNING+ lines from{" "}
          <code className="text-accent-cyan">trevor.log</code> (64KB tail).
        </div>
        {(data?.sentinels?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Activity size={28} />}
            title="No sentinels"
            body="No WARNING+ lines in the recent log tail."
          />
        ) : (
          <ul className="space-y-2">
            {(data?.sentinels ?? []).map((s, i) => (
              <li
                key={`${s.ts ?? "?"}-${i}`}
                className="flex flex-col gap-1 rounded-md border border-border-subtle bg-bg-card px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={pillToneForLevel(s.level)} size="sm">
                    {s.level}
                  </Pill>
                  <Pill tone="cyan" size="sm">
                    {s.tag}
                  </Pill>
                  {s.ts && (
                    <span className="text-micro text-fg-muted">{s.ts}</span>
                  )}
                </div>
                <div className="text-caption text-fg-primary break-words">
                  {s.message}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="text-micro text-fg-muted">
        Snapshot: {data?.snapshot_at?.slice(0, 19).replace("T", " ") ?? "—"}
        {refreshing && " · refreshing…"}
        {data?.error && (
          <span className="text-accent-red"> · error: {data.error}</span>
        )}
      </div>
    </div>
  );
}
