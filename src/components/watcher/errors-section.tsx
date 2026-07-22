"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Pill, EmptyState, Skeleton } from "@/components/ui";
import { fmtAge, fmtUpdated } from "./watcher-format";

/**
 * WATCHER → errors sub-tab. The watcher's real live detections
 * (watcher_errors) + its per-check self-health roll-up (watcher_health), read
 * from data/watcher.db (mode=ro) via /api/watcher/critiques.
 *
 * Rendered HONESTLY: a ~79h stale loop, a dead cron, or a dead critical daemon
 * is correct reporting of genuinely bad live state — NOT a Hub bug. This is the
 * cockpit surface where that oversight finally reaches Ghost.
 */

interface WatcherError {
  id: number;
  source: string;
  summary: string;
  first_seen_ts: string;
  last_seen_ts: string;
  resolved: boolean;
}
interface WatcherHealth {
  check_name: string;
  status: string;
  detail: string | null;
  updated_at: string;
}
interface Resp {
  status: string;
  errors: WatcherError[];
  health: WatcherHealth[];
  updated_seconds: number | null;
  error?: string;
}

const SOURCE_LABEL: Record<string, string> = {
  loop_stall: "loop stalled",
  cron_dead: "dead cron",
  systemctl_failed: "unit down",
  swallowed_canary: "canary swallowed",
};

export function ErrorsSection() {
  const [data, setData] = React.useState<Resp | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/watcher/critiques", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) setData(await res.json());
      } catch {
        // swallow — keep last-good; the branches below cover a null fetch.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-4 p-4 md:p-6 lg:px-8">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="p-4 md:p-6 lg:px-8">
        <EmptyState
          title="Watcher errors unavailable"
          body={
            data?.error
              ? `Couldn't read the watcher's error store right now: ${data.error}`
              : "Couldn't read the watcher's error store right now."
          }
        />
      </div>
    );
  }

  const errors = data.errors ?? [];
  const health = data.health ?? [];
  const unresolved = errors.filter((e) => !e.resolved).length;

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      {/* Freshness — WSL-local store, so this is a real "updated Xs ago". */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-micro text-fg-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-pill bg-accent-cyan-soft" />
          {fmtUpdated(data.updated_seconds)}
        </span>
        <span className="text-fg-faint">·</span>
        <span>
          the watcher watches the loops + daemons and surfaces drift that would
          otherwise die silently
        </span>
      </div>

      {/* ── Errors the watcher surfaced ──────────────────────────────────── */}
      {errors.length === 0 ? (
        <EmptyState
          title="Nothing surfaced right now"
          body="The watcher hasn't flagged any stalled loops, dead crons, or down daemons."
        />
      ) : (
        <section className="space-y-1.5 rounded-md border border-accent-gold/40 bg-accent-gold/5 p-3">
          <h3 className="flex items-center gap-2 font-sans text-caption font-semibold text-accent-gold">
            <span aria-hidden>⚠</span>
            {unresolved > 0
              ? `${unresolved} worth a look — surfaced by the watcher`
              : "all surfaced errors resolved"}
          </h3>
          <p className="font-sans text-micro leading-relaxed text-fg-muted">
            These are real detections of genuinely bad live state — correct
            reporting, not a Hub bug.
          </p>
          <div className="space-y-1.5">
            {errors.map((e) => (
              <div
                key={e.id}
                className="flex flex-col gap-1 rounded-md border border-border-subtle bg-bg-elevated/40 p-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Pill intent={e.resolved ? undefined : "error"} tone={e.resolved ? "neutral" : undefined} size="sm">
                    {SOURCE_LABEL[e.source] ?? e.source}
                  </Pill>
                  {e.resolved && (
                    <Pill tone="neutral" size="sm">
                      resolved
                    </Pill>
                  )}
                  <span className="font-sans text-caption text-fg-primary">{e.summary}</span>
                </div>
                <div className="font-sans text-micro text-fg-muted">
                  first seen {fmtAge(e.first_seen_ts)} ago · last seen{" "}
                  {fmtAge(e.last_seen_ts)} ago
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Watcher self-checks (health) ─────────────────────────────────── */}
      {health.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Watcher self-checks</CardTitle>
          </CardHeader>
          <div className="space-y-1.5 p-3 md:p-4">
            {health.map((h) => (
              <div
                key={h.check_name}
                className="flex flex-col gap-1 border-b border-border-subtle pb-1.5 last:border-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Pill intent={h.status === "ok" ? "active" : "warn"} size="sm">
                    {h.status}
                  </Pill>
                  <span className="font-sans text-caption text-fg-primary">{h.check_name}</span>
                  <span className="ml-auto font-sans text-micro text-fg-faint">
                    {fmtAge(h.updated_at)} ago
                  </span>
                </div>
                {h.detail && (
                  <span className="font-sans text-micro leading-relaxed text-fg-muted">
                    {h.detail}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
