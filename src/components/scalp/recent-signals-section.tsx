"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui";
import { History, ArrowUp, ArrowDown } from "lucide-react";

interface SignalRow {
  id: number;
  ticker: string;
  direction: "LONG" | "SHORT" | string;
  confidence: number;
  outcome?: "WIN" | "LOSS" | "SCRATCH" | null;
  result_pct?: number | null;
  exit_reason?: string | null;
  created_at: string;
  regime?: string;
  quality_tier?: string;
}

interface SignalsResponse {
  total?: number;
  signals?: SignalRow[];
}

export function RecentSignalsSection() {
  const [signals, setSignals] = React.useState<SignalRow[] | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const fetchSignals = async () => {
      try {
        const res = await fetch("/api/signals?scope=list&limit=50&page=1", {
          cache: "no-store",
        });
        if (!cancelled && res.ok) {
          const j = (await res.json()) as SignalsResponse;
          setSignals(j.signals ?? []);
        }
      } catch {
        // keep last good state
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchSignals();
    const id = setInterval(fetchSignals, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="space-y-4 p-4 animate-fade-in md:space-y-6 md:p-6 lg:px-8">
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <History size={14} />
              RECENT SIGNALS
            </span>
          </CardTitle>
          {signals && (
            <Pill tone="neutral" size="sm">
              {signals.length}
            </Pill>
          )}
        </CardHeader>

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}

        {!loading && signals && signals.length === 0 && (
          <EmptyState
            title="No recent signals"
            body="Scanner is idle or all signals filtered."
          />
        )}

        {!loading && signals && signals.length > 0 && (
          <ul className="divide-y divide-border-subtle">
            {signals.map((s) => {
              const confTone =
                s.confidence >= 50
                  ? "green"
                  : s.confidence >= 40
                  ? "cyan"
                  : "amber";
              const outcomeTone =
                s.outcome === "WIN"
                  ? "green"
                  : s.outcome === "LOSS"
                  ? "red"
                  : s.outcome === "SCRATCH"
                  ? "neutral"
                  : null;
              return (
                <li
                  key={s.id}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-2 py-2.5 text-caption"
                >
                  {s.direction === "LONG" ? (
                    <ArrowUp size={14} className="text-accent-green" />
                  ) : (
                    <ArrowDown size={14} className="text-accent-red" />
                  )}
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-bold">{s.ticker}</span>
                    <Pill tone={confTone as "green" | "cyan" | "amber"} size="sm">
                      {s.confidence.toFixed(0)}
                    </Pill>
                    <span className="text-micro text-fg-muted">
                      {new Date(s.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {s.regime && (
                      <span className="text-micro text-fg-faint">{s.regime}</span>
                    )}
                  </div>
                  <div className="text-right">
                    {outcomeTone && s.outcome ? (
                      <Pill tone={outcomeTone as "green" | "red" | "neutral"} size="sm">
                        {s.outcome}
                      </Pill>
                    ) : (
                      <span className="text-micro text-fg-faint">open</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
