"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Pill, EmptyState, Skeleton } from "@/components/ui";
import { plainCheck, plainKind, plainOutcome } from "@/lib/plain-labels";
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
interface Resp {
  status: string;
  findings: IntegrityFinding[];
  reconciliation: ReconciliationRow[];
  state: WatcherStateRow[];
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
        if (res.ok) setData(await res.json());
      } catch {
        // swallow — keep last-good.
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

  if (!data || data.error) {
    return (
      <div className="p-4 md:p-6 lg:px-8">
        <EmptyState
          title="Integrity store unavailable"
          body="Couldn't read the integrity records right now."
        />
      </div>
    );
  }

  const findings = data.findings ?? [];
  const reconciliation = data.reconciliation ?? [];
  const state = data.state ?? [];
  const allEmpty = findings.length === 0 && reconciliation.length === 0 && state.length === 0;

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-micro text-fg-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-pill bg-accent-cyan-soft" />
          {fmtUpdated(data.updated_seconds)}
        </span>
        <span className="text-fg-faint">·</span>
        <span>level/ID integrity + declared-vs-detected reconciliation</span>
      </div>

      {allEmpty ? (
        <EmptyState
          title="No integrity findings yet"
          body="Nothing has needed checking yet."
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
