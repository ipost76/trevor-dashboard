"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  EmptyState,
  Skeleton,
} from "@/components/ui";
import {
  Zap,
  ShieldOff,
  Clock,
} from "lucide-react";

interface AuditEntry {
  id: number;
  event_type: string;
  threshold_delta: number | null;
  duration_hours: number | null;
  actor: string | null;
  reason: string | null;
  signals_fired: number | null;
  timestamp: string;
}
interface AggressiveResponse {
  enabled: boolean;
  threshold_delta: number;
  enabled_at?: string | null;
  revert_at?: string | null;
  enabled_by?: string | null;
  reason?: string | null;
  total_signals_fired?: number;
  minutes_until_revert?: number | null;
  toggle_enabled: boolean;
  killswitch_enabled: boolean;
  audit: ReadonlyArray<AuditEntry>;
  error?: string;
}
const POLL_MS = 30_000;

function fmtMinutes(m: number | null | undefined): string {
  if (m === null || m === undefined) return "—";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

export function AggressiveModeSection() {
  const [data, setData] = React.useState<AggressiveResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  const fetchState = React.useCallback(async () => {
    try {
      const res = await fetch("/api/memory/aggressive", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as AggressiveResponse);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchState();
    const id = setInterval(() => void fetchState(), POLL_MS);
    return () => clearInterval(id);
  }, [fetchState]);

  if (loading && !data) {
    return (
      <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const enabled = !!data?.enabled;
  const killswitchOn = !!data?.killswitch_enabled;

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      {/* Hero — current state */}
      <Card padding="lg" className={enabled ? "card-elevated" : "card-base"}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Zap
              size={24}
              className={enabled ? "text-accent-plum" : "text-fg-muted"}
            />
            <div>
              <div className="font-sans text-caption uppercase tracking-wider text-fg-muted">
                Aggressive Mode
              </div>
              <div
                className={
                  "font-sans text-h2 font-semibold " +
                  (enabled ? "text-accent-plum-strong" : "text-fg-primary")
                }
              >
                {enabled ? "ENGAGED" : "Off"}
              </div>
              {enabled && (
                <div className="mt-1 flex flex-wrap items-center gap-2 font-sans text-micro text-fg-muted">
                  <span>Δ <span className="font-mono">{data?.threshold_delta ?? 0}</span></span>
                  {data?.minutes_until_revert !== null &&
                    data?.minutes_until_revert !== undefined && (
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} />
                        revert in <span className="font-mono">{fmtMinutes(data.minutes_until_revert)}</span>
                      </span>
                    )}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col items-start gap-1 md:items-end">
            <Pill
              intent={enabled ? "meme" : undefined}
              tone={enabled ? undefined : "neutral"}
              size="sm"
              pulse={enabled}
            >
              {enabled ? "AGGRESSIVE LIVE" : "STANDARD"}
            </Pill>
            {data?.enabled_at && (
              <span className="font-sans text-micro text-fg-muted">
                set <span className="font-mono">{data.enabled_at.slice(0, 19).replace("T", " ")}</span>
              </span>
            )}
            {data?.enabled_by && (
              <span className="font-sans text-micro text-fg-muted">
                by {data.enabled_by}
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* Description */}
      <Card padding="md">
        <div className="space-y-2 font-sans text-caption text-fg-muted">
          <p>
            Aggressive Mode lowers the signal threshold by <span className="font-mono">{Math.abs(-5)}</span> points
            and removes select scoring brakes for <span className="font-mono">{48}h</span>, then auto-reverts.
          </p>
          <ul className="ml-4 list-disc space-y-1 text-micro">
            <li>Still respects EMERGENCY_KILLSWITCH. Live HL balance is the only capital limit (RM-07 P00).</li>
            <li>Does NOT auto-close any open position.</li>
            <li>Independent of the killswitch — toggle here, not there.</li>
            <li>Queued via hub_commands; bot applies within ~10s.</li>
          </ul>
        </div>
      </Card>

      {/* Killswitch advisory (does NOT block the toggle) */}
      {killswitchOn && (
        <Card padding="md" className="card-warn">
          <div className="flex items-start gap-3">
            <ShieldOff size={20} className="text-accent-gold shrink-0" />
            <div className="space-y-1">
              <div className="font-sans text-caption font-semibold text-accent-gold-strong">
                Killswitch is ENGAGED
              </div>
              <div className="font-sans text-micro text-fg-muted">
                You can still toggle Aggressive Mode here, but no trades will
                execute until the killswitch is released.
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Recent toggles */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>Recent Toggles</CardTitle>
        </CardHeader>
        {(data?.audit?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Clock size={28} />}
            title="No history"
            body="No entries in aggressive_mode_history yet."
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {(data?.audit ?? []).map((row) => {
              const isEnable = row.event_type === "enable";
              const isAuto = row.event_type === "auto_revert";
              return (
                <li
                  key={row.id}
                  className="flex flex-col gap-1 px-1 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {isEnable ? (
                      <Pill intent="meme" size="sm">{row.event_type}</Pill>
                    ) : isAuto ? (
                      <Pill intent="warn" size="sm">{row.event_type}</Pill>
                    ) : (
                      <Pill tone="neutral" size="sm">{row.event_type}</Pill>
                    )}
                    {typeof row.threshold_delta === "number" && row.threshold_delta !== 0 && (
                      <span className="font-sans text-micro text-fg-muted">
                        Δ <span className="font-mono">{row.threshold_delta}</span>
                      </span>
                    )}
                    {row.duration_hours && (
                      <span className="font-sans text-micro text-fg-muted">
                        <span className="font-mono">{row.duration_hours}h</span>
                      </span>
                    )}
                    <span className="font-mono text-micro text-fg-muted ml-auto">
                      {row.timestamp}
                    </span>
                  </div>
                  <div className="font-sans text-micro text-fg-muted">
                    by <span className="text-fg-primary">{row.actor ?? "—"}</span>
                    {row.reason && <> · {row.reason}</>}
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
