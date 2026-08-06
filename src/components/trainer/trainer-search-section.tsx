"use client";
import * as React from "react";
import { Card, EmptyState, Pill, Skeleton } from "@/components/ui";
import { plainAxis, plainStatus } from "@/lib/plain-labels";

// TRAINER · "search" sub-tab. The trainer's config-space search state from
// /api/trainer/search (trainer.db): the settings it is testing, the standing
// ideas, and how it scores them. READ-ONLY display.
// Pre-cutover EMPTY is the display, not an error — 0 settings + 0 ideas render
// a friendly <EmptyState>; the scoring weights show as a small footer.
//
// 🚨 NO HASH REACHES THE SCREEN. Rows used to be titled with a truncated
// arm_hash, which identifies a setting to the database and to nobody else; they
// are titled by what the setting varies instead.
//
// 🚨 EVIDENCE FIRST, PRIORS COLLAPSED. An arm the trainer has never pulled
// carries an UNTOUCHED Beta(1,1) prior, so its posterior mean is exactly 0.5 —
// a starting assumption, not a measurement. This block used to render one tall
// card per arm, so a screen full of untouched priors read as a screen full of
// findings when only a couple of arms had ever been tried. Arms with trials get
// a visible row; arms without collapse behind ONE summary line, and a prior is
// NEVER shown as a percentage.

interface Arm {
  arm_hash: string | null;
  level_id: number | null;
  axes: unknown;
  alpha: number | null;
  beta: number | null;
  n_obs: number | null;
  mean: number | null;
  last_sampled_at: string | null;
}
interface Hypothesis {
  hypothesis_id: string | number | null;
  level_id: number | null;
  domain: string | null;
  claim: string | null;
  n_obs: number | null;
  status: string | null;
  last_updated: string | null;
}
interface Compass {
  level_id: number | null;
  w_consistency: number | null;
  w_magnitude: number | null;
  dd_ceiling: number | null;
  cvar_floor: number | null;
  learned: number | null;
}
interface SearchResponse {
  status: "ok" | "no_data_yet";
  arms: Arm[];
  hypotheses: Hypothesis[];
  compass: Compass | null;
  counts: { arms: number; hypotheses: number };
  error?: string;
}

function num(v: number | null | undefined, d = 3): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(d);
}

/** A 0–1 rate as a whole percentage. */
function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

// F1: titleCase() is gone. It looked like a gloss but only capitalised an
// identifier, which is the subtler half of this defect class — every caller now
// goes through the plain-labels allowlists instead.

// The FAMILY half of a dotted config axis — `size.risk_fraction` → `size`.
// Every axis key in the live payload is dotted while AXIS_PLAIN allowlists the
// family, so a whole-key lookup drops all of them and every row fell back to the
// "Setting N" ordinal. Deriving the family reuses the EXISTING allowlist: no new
// entries, and no English invented for a key nobody has glossed.
function axisFamily(key: string): string {
  const dot = key.indexOf(".");
  return dot > 0 ? key.slice(0, dot) : key;
}

// A row title must say what the setting VARIES, never identify it by hash — a
// hash is meaningless on screen. Falls back to a plain ordinal.
function armTitle(axes: unknown, index: number): string {
  let parsed: unknown = axes;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      /* not JSON — fall through to the ordinal */
    }
  }
  if (parsed && typeof parsed === "object") {
    // 🚨 F1: ALLOWLISTED. These are config-axis identifiers; titleCase() only
    // capitalised them, so "timing_context" reached the screen as "Timing
    // context". An axis with no plain-English label is counted, never named.
    const keys = Object.keys(parsed as Record<string, unknown>).filter(Boolean);
    const named: string[] = [];
    let dropped = 0;
    for (const k of keys) {
      const label = plainAxis(axisFamily(k));
      if (label === null) {
        dropped += 1;
      } else if (!named.includes(label)) {
        // Two keys of one family name it once — "Position size · Position size"
        // is noise, and the dropped tally counts unmapped keys, not duplicates.
        named.push(label);
      }
    }
    if (named.length > 0) {
      return dropped > 0
        ? `${named.join(" · ")} · +${dropped} more`
        : named.join(" · ");
    }
  }
  return `Setting ${index + 1}`;
}

// Display names for the WHOLE arms array. Two arms that vary the same family
// derive the same title, so a trailing ordinal keeps them apart — they are
// different arms and must never read as one row. Computed over the full array
// (not per group) so a title cannot change when a row moves between groups.
// "Setting N" fallbacks are unique by index and so never take an ordinal.
function armTitles(arms: Arm[]): string[] {
  const base = arms.map((a, i) => armTitle(a.axes, i));
  const total = new Map<string, number>();
  for (const t of base) total.set(t, (total.get(t) ?? 0) + 1);
  const seen = new Map<string, number>();
  return base.map((t) => {
    if ((total.get(t) ?? 0) < 2) return t;
    const n = (seen.get(t) ?? 0) + 1;
    seen.set(t, n);
    return `${t} (${n})`;
  });
}

/** Below this many trials a rate is dominated by the prior, so none is shown. */
const MIN_TRIALS_FOR_RATE = 5;

// 🚨 α − 1 IS A REWARD SUM, NOT A WIN COUNT. `trainer_bandit.update_posterior`
// seeds (1,1) and does `α += reward` / `β += (1 − reward)` for a CONTINUOUS
// reward ∈ [0,1], so a discrete win/loss record exists only when every reward
// landed on exactly 0 or 1. Returns null otherwise — rendering "0.9 wins" would
// invent a record the trainer never had.
function winRecord(a: Arm): { wins: number; trials: number } | null {
  const { alpha, beta, n_obs } = a;
  if (alpha === null || beta === null || n_obs === null) return null;
  const whole = (x: number) =>
    Number.isFinite(x) && Math.abs(x - Math.round(x)) < 1e-9;
  if (!whole(alpha - 1) || !whole(beta - 1)) return null;
  const wins = Math.round(alpha - 1);
  const losses = Math.round(beta - 1);
  if (wins < 0 || losses < 0 || wins + losses !== n_obs) return null;
  return { wins, trials: n_obs };
}

/**
 * The evidence line for ONE arm, or null when there is no evidence to state.
 *
 * A percentage is a measurement and only appears once there is enough evidence
 * to be one. Below the floor the raw record is shown instead — it is shorter
 * than a percentage and cannot be misread as a measured rate.
 */
function evidenceLine(a: Arm): string | null {
  const n = a.n_obs ?? 0;
  if (n <= 0) return null;
  if (n >= MIN_TRIALS_FOR_RATE) return `Winning ${pct(a.mean)} over ${n} trials`;
  const rec = winRecord(a);
  if (rec) {
    return `${rec.wins} ${rec.wins === 1 ? "win" : "wins"} in ${rec.trials} ${
      rec.trials === 1 ? "trial" : "trials"
    }`;
  }
  return `Tried ${n} ${n === 1 ? "time" : "times"} — too few to rate`;
}

// How the trainer scores a setting — ONE line. This was a 2×2 grid of four
// labelled numbers with a <br/> in every cell: eight text lines and a card
// header for four values that read fine in a sentence. Values are read live;
// none is hardcoded.
function CompassCard({ c }: { c: Compass }) {
  return (
    <Card className="card-base">
      <p className="px-3 py-2 font-sans text-caption leading-snug text-fg-muted">
        Scoring: consistency{" "}
        <span className="font-mono text-fg-primary">{num(c.w_consistency, 2)}</span> · edge size{" "}
        <span className="font-mono text-fg-primary">{num(c.w_magnitude, 2)}</span> · max drawdown{" "}
        <span className="font-mono text-fg-primary">{num(c.dd_ceiling, 2)}</span> · loss floor{" "}
        <span className="font-mono text-fg-primary">{num(c.cvar_floor, 2)}</span>
      </p>
    </Card>
  );
}

export function TrainerSearchSection() {
  const [data, setData] = React.useState<SearchResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  // EPHEMERAL BY DESIGN — the untested list re-collapses on every load. The Hub
  // uses no browser storage, so this state deliberately does not survive one.
  const [showUntested, setShowUntested] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/trainer/search", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) setData(await res.json());
      } catch {
        /* keep last-good */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const arms = data?.arms ?? [];
  const hypotheses = data?.hypotheses ?? [];
  const compass = data?.compass ?? null;
  const empty = arms.length === 0 && hypotheses.length === 0;

  // Partition at render time — the source array is never mutated.
  const titles = armTitles(arms);
  const rows = arms.map((arm, index) => ({ arm, index, title: titles[index] }));
  const tested = rows.filter((r) => (r.arm.n_obs ?? 0) > 0);
  const untested = rows.filter((r) => (r.arm.n_obs ?? 0) === 0);

  // Every arm sits at one level today, so the level belongs in the header ONCE
  // rather than as an identical pill on every row. If they ever diverge it moves
  // inline onto the row it describes — a header saying "all at level N" must
  // never be a lie.
  const levels = Array.from(
    new Set(arms.map((a) => a.level_id).filter((l): l is number => l !== null)),
  );
  const oneLevel = levels.length === 1 ? levels[0] : null;

  if (loading && data === null) {
    return <Skeleton className="h-48 w-full" />;
  }

  return (
    <div className="space-y-4">
      <p className="font-sans text-micro leading-relaxed text-fg-muted">
        What the trainer is testing right now: the settings it likes best, the ideas
        it&apos;s still gathering evidence on, and how it scores them.
      </p>

      {empty ? (
        <EmptyState
          title="No trainer search yet"
          body="The trainer hasn't tried any settings yet. This fills in once it starts searching."
        />
      ) : (
        <>
          {arms.length > 0 && (
            <section className="space-y-1">
              <h3 className="font-sans text-micro uppercase tracking-wider text-fg-muted">
                Settings being tested ({arms.length})
                {tested.length > 0 && ` · ${tested.length} with evidence`}
                {untested.length > 0 && ` · ${untested.length} not tried yet`}
                {oneLevel !== null && ` · all at level ${oneLevel}`}
              </h3>

              {tested.length > 0 && (
                <ul className="divide-y divide-border-subtle border-y border-border-subtle">
                  {tested.map((r) => (
                    <li
                      key={r.arm.arm_hash ?? r.index}
                      className="flex flex-wrap items-baseline gap-x-2 py-1.5"
                    >
                      <span className="font-sans text-caption text-fg-primary">{r.title}</span>
                      <span className="text-fg-faint">·</span>
                      <span className="font-sans text-caption text-fg-muted">
                        {evidenceLine(r.arm)}
                      </span>
                      {oneLevel === null && r.arm.level_id !== null && (
                        <span className="font-sans text-caption text-fg-faint">
                          level {r.arm.level_id}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {untested.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowUntested((v) => !v)}
                    aria-expanded={showUntested}
                    className="flex w-full flex-wrap items-baseline gap-x-2 py-1.5 text-left"
                  >
                    <span className="font-sans text-caption text-fg-primary">
                      {untested.length} {untested.length === 1 ? "setting" : "settings"} not
                      tried yet
                    </span>
                    <span className="font-sans text-caption text-fg-muted">
                      — no evidence either way.{" "}
                      {showUntested ? "Tap to hide." : "Tap to list them."}
                    </span>
                  </button>
                  {showUntested && (
                    <ul className="pb-1 pl-3">
                      {untested.map((r) => (
                        <li
                          key={r.arm.arm_hash ?? r.index}
                          className="font-sans text-caption leading-snug text-fg-muted"
                        >
                          {r.title}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}

          {hypotheses.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="font-sans text-micro uppercase tracking-wider text-fg-muted">
                Ideas being tested ({hypotheses.length})
              </h3>
              {hypotheses.map((h, i) => (
                <div
                  key={h.hypothesis_id ?? i}
                  className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-bg-card px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-sans text-caption text-fg-primary line-clamp-2">
                      {h.claim ?? "—"}
                    </span>
                    {h.status && (
                      <Pill tone="neutral" size="sm">{plainStatus(h.status)}</Pill>
                    )}
                  </div>
                  <span className="font-sans text-micro text-fg-faint">
                    {h.domain ? (plainAxis(h.domain) ?? "Other area") : "—"} ·{" "}
                    <span className="font-mono">{h.n_obs ?? 0}</span>{" "}
                    {(h.n_obs ?? 0) === 1 ? "observation" : "observations"}
                    {h.level_id !== null ? ` · Level ${h.level_id}` : ""}
                  </span>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {compass && <CompassCard c={compass} />}
    </div>
  );
}
