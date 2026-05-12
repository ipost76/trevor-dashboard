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

function pillToneForLevel(lv: string): "amber" | "red" | "magenta" {
  if (lv === "ERROR") return "red";
  if (lv === "CRITICAL") return "magenta";
  return "amber";
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
      <div className="mb-3 text-micro text-fg-muted">
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
              <div className="break-words text-caption text-fg-primary">
                {s.message}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
