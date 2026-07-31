"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Pill, Skeleton } from "@/components/ui";
import { plainCheck } from "@/lib/plain-labels";
import { fmtAge } from "./watcher-format";

/**
 * WATCHER → level sub-tab (H6). The minted level chain, read PURE-SSH from the
 * VM level engine (/api/watcher/level -> query_level_state.py). The level is
 * NEVER guessed or proxied: on any pipe failure the reader returns
 * status:"unknown" and this renders "level: unknown (pipe unavailable)" — a
 * calm honest degradation, not an alarm.
 *
 * At L0 the integrity checks pass VACUOUSLY (nothing to check) — rendered
 * "checks ran — nothing to check yet", distinct from a verified pass. The
 * config-tested cross-reference is scaffolded (awaiting R8) — expected-empty.
 */

interface LevelHistoryRow {
  level: number;
  created_at: string | null;
  money_path_change: string | null;
  prompt_id: string | null;
  commit_hash: string | null;
  is_revert: boolean;
  notes: string | null;
}
interface IntegrityCheck {
  check: string;
  ok: boolean;
  findings: unknown[];
}
interface LevelIntegrity {
  status: string;
  ok?: boolean;
  checks?: IntegrityCheck[];
  vacuous?: boolean;
  reason?: string | null;
}
interface LevelConfigTested {
  status: string;
  populated?: boolean;
  r8_dependency?: string | null;
  tested_at_levels?: number[];
  reason?: string | null;
}
interface Resp {
  status: "ok" | "unknown" | string;
  reason?: string;
  current_level?: number;
  history?: LevelHistoryRow[];
  history_status?: string;
  integrity?: LevelIntegrity;
  config_tested?: LevelConfigTested;
  error?: string;
}

export function LevelSection() {
  const [data, setData] = React.useState<Resp | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/watcher/level", { cache: "no-store" });
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

  // Hard UNKNOWN — never a guessed level. A calm degraded card, NOT a red alarm.
  if (!data || data.status !== "ok" || typeof data.current_level !== "number") {
    const reason = data?.reason ?? data?.error ?? "pipe unavailable";
    return (
      <div className="p-4 md:p-6 lg:px-8">
        <Card className="card-warn">
          <div className="space-y-1.5 p-4">
            <div className="flex items-center gap-2">
              <Pill intent="warn" size="sm">
                unknown
              </Pill>
              <span className="font-sans text-body font-semibold text-fg-primary">
                level: unknown (pipe unavailable)
              </span>
            </div>
            <p className="font-sans text-micro leading-relaxed text-fg-muted">
              The level lives only on the VM and the read pipe couldn&apos;t
              confirm it — so it&apos;s reported as unknown, never a guessed
              value. {reason}
            </p>
          </div>
        </Card>
      </div>
    );
  }

  const level = data.current_level;
  const history = data.history ?? [];
  const integ = data.integrity;
  const cfg = data.config_tested;
  const baselineLabel = level === 0 ? "v4 baseline" : `level ${level}`;

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      {/* Current level — prominent, never blank. */}
      <Card className="card-elevated">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
          <span className="font-mono text-h1 font-bold text-fg-primary">Level {level}</span>
          <span className="font-sans text-caption text-accent-cyan-soft-strong">
            {baselineLabel}
          </span>
          {level === 0 && (
            <span className="font-sans text-micro text-fg-muted">
              the frozen pre-rebuild money path · v4 PAUSED
            </span>
          )}
        </div>
      </Card>

      {/* History — what changed at each level. */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Level history</CardTitle>
          </CardHeader>
          <div className="space-y-1.5 p-3 md:p-4">
            {history
              .slice()
              .reverse()
              .map((h) => (
                <div
                  key={h.level}
                  className="flex flex-col gap-1 border-b border-border-subtle pb-1.5 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="neutral" size="sm">
                      Level {h.level}
                    </Pill>
                    {h.is_revert && (
                      <Pill intent="warn" size="sm">
                        reverted
                      </Pill>
                    )}
                    <span className="font-sans text-caption text-fg-primary">
                      {h.money_path_change ?? "No description recorded"}
                    </span>
                    <span className="ml-auto font-sans text-micro text-fg-faint">
                      {fmtAge(h.created_at)} ago
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Integrity — vacuous vs verified vs unavailable. */}
      {integ && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Chain integrity</CardTitle>
              {integ.status !== "ok" ? (
                <Pill intent="warn" size="sm">
                  unavailable
                </Pill>
              ) : integ.vacuous ? (
                <Pill tone="neutral" size="sm">
                  checks ran — nothing to check yet
                </Pill>
              ) : integ.ok ? (
                <Pill intent="active" size="sm">
                  verified
                </Pill>
              ) : (
                <Pill intent="error" size="sm">
                  drift found
                </Pill>
              )}
            </div>
          </CardHeader>
          <div className="space-y-1.5 p-3 md:p-4">
            {integ.status !== "ok" ? (
              <p className="font-sans text-micro leading-relaxed text-fg-muted">
                Couldn&apos;t check the bot&apos;s integrity right now.
              </p>
            ) : (
              <>
                {integ.vacuous && (
                  <p className="font-sans text-micro leading-relaxed text-fg-muted">
                    At level 0 there are no money-path changes above the baseline,
                    so the checks pass with nothing to verify — a trivially-true
                    result, not a verified pass.
                  </p>
                )}
                {(integ.checks ?? []).map((c) => (
                  <div
                    key={c.check}
                    className="flex flex-wrap items-center gap-2 border-b border-border-subtle pb-1.5 last:border-0 last:pb-0"
                  >
                    <span
                      aria-hidden
                      className={
                        "h-1.5 w-1.5 rounded-pill " +
                        (c.ok ? "bg-accent-mint-strong" : "bg-accent-red")
                      }
                    />
                    <span className="font-sans text-micro text-fg-primary">
                      {plainCheck(c.check)}
                    </span>
                    {c.findings.length > 0 && (
                      <span className="font-sans text-micro text-accent-red">
                        {c.findings.length === 1
                          ? "1 problem"
                          : `${c.findings.length} problems`}
                      </span>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </Card>
      )}

      {/* Config-tested cross-reference — scaffolded (awaiting R8). */}
      {cfg && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Config testing</CardTitle>
              <Pill tone="neutral" size="sm">
                {cfg.status !== "ok"
                  ? "unavailable"
                  : cfg.populated
                    ? "recorded"
                    : "not started yet"}
              </Pill>
            </div>
          </CardHeader>
          <div className="p-3 md:p-4">
            <p className="font-sans text-micro leading-relaxed text-fg-muted">
              {cfg.status !== "ok"
                ? "Couldn't cross-check the settings right now."
                : "Test results aren't being recorded against each level yet. That's expected at this stage, not a fault."}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
