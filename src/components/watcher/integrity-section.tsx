"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Pill, EmptyState, Skeleton } from "@/components/ui";
import { plainCheck, plainCheckStrict, plainKind, plainOutcome } from "@/lib/plain-labels";
import { fmtAge, fmtUpdated } from "./watcher-format";

/**
 * WATCHER → integrity sub-tab. The watcher's SEPARATE must-never-drift store
 * (data/watcher_integrity.db mode=ro via /api/watcher/integrity): recorded
 * integrity_findings + the declared-vs-detected reconciliation_log + state.
 *
 * Reconciliation is DANGEROUS-FIRST: undeclared_trading_change (detected but
 * never declared) ranks above declared_not_detected (a tripwire gap), then
 * newest. A vacuous ok (L0, nothing to check) reads "checks ran — nothing to
 * check yet", never a verified pass. Pre-cutover all three are empty by design.
 */

interface IntegrityFinding {
  id: number;
  check_name: string;
  ok: boolean;
  vacuous: boolean;
  findings_count: number;
  findings: string[];
  finding_pairs: { key: string; value: string }[];
  findings_dropped: number;
  level_id: number | null;
  ts: string;
}
interface ReconciliationRow {
  id: number;
  prompt_id: string | null;
  outcome: string;
  kind: string | null;
  kind_rank: number;
  triggers: string[];
  resolved: boolean;
  ts: string;
}
interface WatcherStateRow {
  key: string;
  value: string | null;
  updated_at: string;
}
interface UnreadableTable {
  table: string;
  reason: string;
}
interface Resp {
  /** 🚨 "ok" | "degraded" | "unknown". Only "ok" means every table was READ. */
  status: string;
  findings: IntegrityFinding[];
  reconciliation: ReconciliationRow[];
  state: WatcherStateRow[];
  unreadable_tables?: UnreadableTable[];
  updated_seconds: number | null;
  error?: string;
}

function findingPill(f: IntegrityFinding): { intent?: "active" | "warn" | "error"; tone?: "neutral"; label: string } {
  if (!f.ok) return { intent: "error", label: "finding" };
  if (f.vacuous) return { tone: "neutral", label: "nothing to check yet" };
  return { intent: "active", label: "passed" };
}

export function IntegritySection() {
  const [data, setData] = React.useState<Resp | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/watcher/integrity", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) {
          setData(await res.json());
        } else {
          // 🚨 B2: a non-2xx used to leave `data` at null/last-good. Null falls
          // into the unavailable branch by luck; a LAST-GOOD payload does not —
          // it keeps painting a stale clean bill of health after the store has
          // gone unreadable. An unreadable store is NAMED, never inherited.
          setData({
            status: "unknown",
            findings: [],
            reconciliation: [],
            state: [],
            updated_seconds: null,
            error: `HTTP ${res.status}`,
          });
        }
      } catch {
        // Same rule on a network failure: say UNKNOWN, never keep last-good.
        if (!cancelled) {
          setData({
            status: "unknown",
            findings: [],
            reconciliation: [],
            state: [],
            updated_seconds: null,
            error: "unreachable",
          });
        }
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
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // 🚨 B2 — THIS BRANCH USED TO READ `!data || data.error` AND NOTHING ELSE.
  // It never consulted `status`, so a producer-side "unknown" would have been
  // INVISIBLE here: the fix would have landed at the helper and changed nothing
  // on screen. That is failure mode 1 in a second shape, and it is why this had
  // to land at both ends.
  const unknown =
    !data || data.status === "unknown" || (!!data.error && data.status !== "degraded");
  // DEGRADED: the store opened, but a table that EXISTS could not be read — so
  // the lists below are INCOMPLETE. We still render what did load (a dangerous
  // reconciliation row must not be hidden by a partial failure) and say plainly
  // that it is partial.
  const degraded = !unknown && data!.status === "degraded";

  if (unknown) {
    return (
      <div className="p-4 md:p-6 lg:px-8">
        <EmptyState
          title="Integrity store unreadable"
          body="The integrity records could not be read. This is NOT an all-clear — an undeclared trading change may or may not have been recorded. Check the watcher store directly before acting."
        />
      </div>
    );
  }

  const findings = data!.findings ?? [];
  const reconciliation = data!.reconciliation ?? [];
  const state = data!.state ?? [];
  const unreadableTables = data!.unreadable_tables ?? [];
  const allEmpty = findings.length === 0 && reconciliation.length === 0 && state.length === 0;

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-micro text-fg-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-pill bg-accent-cyan-soft" />
          {fmtUpdated(data!.updated_seconds)}
        </span>
        <span className="text-fg-faint">·</span>
        <span>level/ID integrity + declared-vs-detected reconciliation</span>
      </div>

      {/* 🚨 PARTIAL READ. Rendered ABOVE the lists, because everything below it
          is incomplete and an empty list here does not mean "nothing found".
          The reason codes are the producer's STRUCTURE; the English is chosen
          here, never interpolated from a sqlite message. */}
      {degraded && (
        <Card padding="md" className="card-warn">
          <div className="font-sans text-label font-semibold text-accent-gold">
            Partial read — this list is incomplete
          </div>
          <div className="mt-1 font-sans text-micro text-fg-muted">
            {unreadableTables.length} of the integrity store&rsquo;s tables exist but could not
            be read
            {unreadableTables.length > 0 && (
              <>
                {" ("}
                {unreadableTables.map((t) => t.table).join(", ")}
                {")"}
              </>
            )}
            . Anything recorded in them is missing from this page. This is NOT an all-clear.
          </div>
        </Card>
      )}

      {allEmpty ? (
        <EmptyState
          title={degraded ? "Nothing readable to show" : "No integrity findings yet"}
          body={
            degraded
              ? "Every table that exists failed to read, so this page can say nothing about integrity either way."
              : "Nothing has needed checking yet."
          }
        />
      ) : (
        <>
          {/* ── Reconciliation (dangerous-first) ─────────────────────────── */}
          {reconciliation.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Reconciliation</CardTitle>
              </CardHeader>
              <div className="space-y-1.5 p-3 md:p-4">
                {reconciliation.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-col gap-1 border-b border-border-subtle pb-1.5 last:border-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill
                        intent={r.kind_rank === 0 ? "error" : "warn"}
                        size="sm"
                      >
                        {plainKind(r.kind)}
                      </Pill>
                      {r.resolved && (
                        <Pill tone="neutral" size="sm">
                          resolved
                        </Pill>
                      )}
                      <span className="font-sans text-caption text-fg-primary">
                        {plainOutcome(r.outcome)}
                      </span>
                      <span className="ml-auto font-sans text-micro text-fg-faint">
                        {fmtAge(r.ts)} ago
                      </span>
                    </div>
                    {/* The raw triggers are prefixed file paths ("file:foo.py") —
                        a count is the fact worth showing, not the paths. */}
                    {r.triggers.length > 0 && (
                      <div className="font-sans text-micro text-fg-muted">
                        {r.triggers.length === 1
                          ? "Triggered by 1 change."
                          : `Triggered by ${r.triggers.length} changes.`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── Integrity findings ───────────────────────────────────────── */}
          {findings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Integrity checks</CardTitle>
              </CardHeader>
              <div className="space-y-1.5 p-3 md:p-4">
                {findings.map((f) => {
                  const p = findingPill(f);
                  return (
                    <div
                      key={f.id}
                      className="flex flex-col gap-1 border-b border-border-subtle pb-1.5 last:border-0 last:pb-0"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill intent={p.intent} tone={p.tone} size="sm">
                          {p.label}
                        </Pill>
                        <span className="font-sans text-caption text-fg-primary">
                          {plainCheck(f.check_name)}
                        </span>
                        {f.level_id !== null && (
                          <span className="font-sans text-micro text-fg-faint">
                            Level {f.level_id}
                          </span>
                        )}
                        <span className="ml-auto font-sans text-micro text-fg-faint">
                          {fmtAge(f.ts)} ago
                        </span>
                      </div>
                      {f.findings.length > 0 && (
                        <div className="font-mono text-micro text-fg-muted">
                          {f.findings.join(" · ")}
                        </div>
                      )}
                      {/* F1: the per-check pairs arrive STRUCTURED now.
                          query_watcher_integrity.py used to serialize them to
                          "k=v" server-side, which is why the CHECK_PLAIN map
                          that already names these keys never got to run. */}
                      {(() => {
                        const named = (f.finding_pairs ?? [])
                          .map((p) => [plainCheckStrict(p.key), p.value] as const)
                          .filter((e): e is readonly [string, string] => e[0] !== null);
                        const dropped =
                          (f.finding_pairs ?? []).length -
                          named.length +
                          (f.findings_dropped ?? 0);
                        if (named.length === 0 && dropped === 0) return null;
                        return (
                          <div className="font-sans text-micro text-fg-muted">
                            {[
                              ...named.map(([label, v]) => `${label}: ${v}`),
                              ...(dropped > 0 ? [`+${dropped} more`] : []),
                            ].join(" · ")}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* ── Integrity module state ───────────────────────────────────── */}
          {state.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Integrity state</CardTitle>
              </CardHeader>
              <div className="space-y-1 p-3 md:p-4">
                {state.map((s) => (
                  <div key={s.key} className="flex flex-wrap items-center gap-2 font-mono text-micro">
                    <span className="text-accent-cyan-soft">{s.key}</span>
                    <span className="text-fg-primary">{s.value ?? "—"}</span>
                    <span className="ml-auto text-fg-faint">{fmtAge(s.updated_at)} ago</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
