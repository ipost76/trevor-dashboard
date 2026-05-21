"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Pill, EmptyState } from "@/components/ui";
import { Activity } from "lucide-react";

// HB-04: split out of G2's health-section.tsx (2026-05-01) so the new
// HeartbeatView could replace the services/probes display while keeping the
// sentinels card's unique diagnostic value (last 10 WARNING+ lines from
// trevor.log). Same data source (/api/memory/health → query_system_health.py),
// same render logic, same 30s polling cadence. Only the data shape consumed
// from that endpoint is the sentinels array; other fields ignored.

interface SentinelEntry {
  ts: string | null;
  level: string;
  tag: string;
  message: string;
}
interface HealthResponse {
  sentinels?: ReadonlyArray<SentinelEntry>;
  error?: string;
}

const POLL_MS = 30_000;

function intentForLevel(lv: string): "error" | "warn" {
  // Per Ghost B2 decision (c): CRITICAL maps to intent="error" (red) for
  // semantic clarity — the magenta-vs-red distinction is sacrificed for a
  // single severe-state color.
  if (lv === "ERROR" || lv === "CRITICAL") return "error";
  return "warn";
}

export function SentinelsCard() {
  const [data, setData] = React.useState<HealthResponse | null>(null);

  const fetchSentinels = React.useCallback(async () => {
    try {
      const res = await fetch("/api/memory/health", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as HealthResponse);
    } catch {
      /* keep prior data on transient errors */
    }
  }, []);

  React.useEffect(() => {
    void fetchSentinels();
    const id = setInterval(() => void fetchSentinels(), POLL_MS);
    return () => clearInterval(id);
  }, [fetchSentinels]);

  return (
    <Card padding="md">
      <CardHeader>
        <CardTitle>Recent Sentinels</CardTitle>
      </CardHeader>
      <div className="mb-3 font-sans text-micro text-fg-muted">
        Last <span className="font-mono">{data?.sentinels?.length ?? 0}</span> WARNING+ lines from{" "}
        <code className="font-mono text-accent-cyan-soft">trevor.log</code> (64KB tail).
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
                <Pill intent={intentForLevel(s.level)} size="sm">
                  {s.level}
                </Pill>
                <Pill
                  tone="cyan"
                  size="sm"
                  className="bg-accent-cyan-soft/10 text-accent-cyan-soft-strong border-accent-cyan-soft/30"
                >
                  {s.tag}
                </Pill>
                {s.ts && (
                  <span className="font-mono text-micro text-fg-muted">{s.ts}</span>
                )}
              </div>
              <div className="break-words font-mono text-caption text-fg-primary">
                {s.message}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
