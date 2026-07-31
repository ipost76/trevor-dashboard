"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Pill, EmptyState, Skeleton } from "@/components/ui";
import { plainCheck, plainCheckDetail, plainSource, plainStatus } from "@/lib/plain-labels";
import { fmtAge, fmtPanelUpdated, fmtUpdated } from "./watcher-format";

/**
 * WATCHER → errors sub-tab. The watcher's recorded detections (watcher_errors)
 * + its per-check self-health roll-up (watcher_health), read from
 * data/watcher.db (mode=ro) via /api/watcher/critiques.
 *
 * 🚨 These rows are RECORDED DETECTIONS, not a live reading — each panel shows
 * its OWN newest write (errors_updated_at / health_updated_at) rather than the
 * shared headline, so one pool can never re-badge another's freshness. The
 * arming banner in <WatcherZoneView/> says when a cycle last ran at all.
 *
 * (This header and the panel subtitle both used to vouch for the stored rows as
 * a correct description of the system right now. Nothing had checked, and every
 * stored row is historical or masked-by-design. Both claims are gone: an
 * unverified assertion in a comment outlives the string on screen and misteaches
 * the next reader. State what a returned field says, or say nothing.)
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
  errors_updated_at: string | null;
  health_updated_at: string | null;
  error?: string;
}

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
            "Couldn't read the watcher's records right now."
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
          Checks that the bot&apos;s background jobs are still running, and flags
          the ones that quietly stopped.
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
              ? `${unresolved} recorded detections — none marked resolved`
              : "every recorded detection is marked resolved"}
          </h3>
          {/* What is actually known: these are stored rows, and the newest write
              to this pool is what the age below reports. No claim is made about
              whether any of them still describes the system now — nothing has
              re-checked them, so nothing could support that claim. */}
          <p className="font-sans text-micro leading-relaxed text-fg-muted">
            Recorded detections, {fmtPanelUpdated(data.errors_updated_at)} — not a
            live reading. Nothing has re-checked them since.
          </p>
          <div className="space-y-1.5">
            {errors.map((e) => (
              <div
                key={e.id}
                className="flex flex-col gap-1 rounded-md border border-border-subtle bg-bg-elevated/40 p-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Pill intent={e.resolved ? undefined : "error"} tone={e.resolved ? "neutral" : undefined} size="sm">
                    {plainSource(e.source)}
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
            {/* This pool's OWN newest write. It is deliberately not the headline:
                the self-health bookkeeping row is written more recently than the
                surface checks, so a shared age would let it speak for rows it
                has nothing to do with. */}
            <span className="font-sans text-micro text-fg-muted">
              {fmtPanelUpdated(data.health_updated_at)}
            </span>
          </CardHeader>
          <div className="space-y-1.5 p-3 md:p-4">
            {health.map((h) => (
              <div
                key={h.check_name}
                className="flex flex-col gap-1 border-b border-border-subtle pb-1.5 last:border-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Pill intent={h.status === "ok" ? "active" : "warn"} size="sm">
                    {plainStatus(h.status)}
                  </Pill>
                  <span className="font-sans text-caption text-fg-primary">
                    {plainCheck(h.check_name)}
                  </span>
                  <span className="ml-auto font-sans text-micro text-fg-faint">
                    {fmtAge(h.updated_at)} ago
                  </span>
                </div>
                {/* The store still holds rows written before the writer spoke English,
                    and nothing rewrites them — so degrade anything that doesn't read
                    as a sentence to a neutral phrase rather than printing it raw.
                    F1: the floor is unchanged; what sits on top of it is a per-check
                    AUTHORED sentence, so a flagged check now says WHICH check and
                    what it looks at. An unmapped check_name still lands on the
                    generic floor — never on the raw detail. */}
                <span className="font-sans text-micro leading-relaxed text-fg-muted">
                  {plainCheckDetail(h.check_name, h.detail, h.status)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
