"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Skeleton } from "@/components/ui";

// ─────────────────────────────────────────────────────────────────────────────
// RM-CUTOVER Wave C · C4 Phase 2 — the dual-instance shadow-week card.
//
// Renders GET /api/shadow-week, which renders B4's panel.json, which renders B1's
// findings. 🚨 EVERY VERDICT STRING IS CARRIED VERBATIM AND NONE IS RECOMPUTED.
// B1 owns the classification; B4 owns the vocabulary. Two systems that each derive
// a class will eventually disagree, and then neither can be trusted.
//
// 🚨 ADDITIVE. This card is a NEW surface reading a NEW route. It changes no
//    existing route's data source. The Hub keeps reading the VM.
//
// The load-bearing rendering rules (B4's C4_HUB_PANEL_SPEC.md §4):
//   1. `drift` renders ONLY drift_count. BLINDNESS / RESOURCE / UNCOMPARABLE /
//      SUPPRESSED are NEVER added into it and NEVER styled like it. A blind
//      instance and a disagreeing instance are different problems with different
//      fixes; merging them sends Ghost hunting a code difference that is not there.
//   2. `harness_state` OUTRANKS EVERYTHING. NOT-STARTED / STOPPED render INSTEAD
//      of a green tick, never beside one. clean_days is meaningless if nothing is
//      comparing.
//   3. `day_state = HOLD` is not CLEAN. Its own state. A day that measured nothing
//      did not pass.
// Plus, from A7 and this prompt:
//   4. UNCOMPARABLE is never green and never reads as agreement. Epsilon is
//      deliberately UNKNOWN until C5's warm-up derives it, so UNCOMPARABLE will be
//      common early. If it reads as a pass, the week proves nothing.
//   5. NO DATA is its own state, never a clean day.
//   6. A one-sided view renders UNREACHABLE — never green, never omitted.
//
// Mobile-first: verified at 375px (the `xs` breakpoint).
// ─────────────────────────────────────────────────────────────────────────────

const ENDPOINT = "/api/shadow-week";
const POLL_MS = 120_000; // the puller runs every 15 min; a 2-min poll is plenty

interface PassCondition {
  id: string;
  status: string;
  last_fail_day: string | null;
}
interface ShadowRow {
  generated_at_et: string;
  tz_asserted: string;
  day: string;
  clean_days: number;
  target_days: number;
  day_state: string;
  day_cause: string | null;
  harness_state: string;
  last_heartbeat_age_s: number | null;
  drift_count: number;
  not_drift: Record<string, number>;
  pass_conditions: PassCondition[];
  age_s: number | null;
}
interface ShadowData {
  panel_state: "OK" | "NO_DATA" | "UNREACHABLE" | "STALE";
  reason: string;
  stale: boolean;
  row: ShadowRow | null;
  fetch: { fetched_at_utc: string; ok: number; source: string; error: string | null } | null;
}

// 🚨 B4's marker table, copied VERBATIM (SHADOW_WATCH.md §2). Each class gets its
//    OWN glyph, OWN colour and OWN label so that no two can be confused at a
//    glance. A RESOURCE line formatted like a DRIFT line loses the distinction
//    exactly where it matters.
const CLASS_STYLE: Record<
  string,
  { glyph: string; label: string; cls: string; note: string }
> = {
  DRIFT: {
    glyph: "🔴", label: "DRIFT",
    cls: "border-red-500/60 bg-red-500/10 text-red-300",
    note: "the instances disagree — investigate the decision",
  },
  BLINDNESS: {
    glyph: "🟠", label: "BLINDNESS",
    cls: "border-orange-500/60 bg-orange-500/10 text-orange-300",
    note: "API/BUDGET FAULT — a dead brain, not a different one",
  },
  RESOURCE: {
    glyph: "🟡", label: "RESOURCE",
    cls: "border-yellow-500/60 bg-yellow-500/10 text-yellow-200",
    note: "throttling / starvation / mark outage",
  },
  STATE_DIVERGENCE: {
    glyph: "🟣", label: "STATE_DIVERGENCE",
    cls: "border-purple-500/60 bg-purple-500/10 text-purple-300",
    note: "the books differ; decision comparison is void",
  },
  TERMINAL: {
    glyph: "⛔", label: "TERMINAL",
    cls: "border-red-700/70 bg-red-900/30 text-red-200",
    note: "a precondition of the week failed — halt the week",
  },
  UNCOMPARABLE: {
    glyph: "⚪", label: "UNCOMPARABLE",
    cls: "border-slate-400/60 bg-slate-400/10 text-slate-200",
    note: "not evidence — never agreement, never green",
  },
  SUPPRESSED: {
    glyph: "▫️", label: "SUPPRESSED",
    cls: "border-zinc-600/60 bg-zinc-700/20 text-zinc-400",
    note: "not run; a root incident made it meaningless",
  },
};

// 🚨 An unrecognised class must still render, and must NOT render as agreement.
//    B4 adds classes without a code change here by design; a silently-dropped
//    class would be a finding that vanished.
const UNKNOWN_CLASS = {
  glyph: "❔", label: "UNKNOWN CLASS",
  cls: "border-fuchsia-500/60 bg-fuchsia-500/10 text-fuchsia-200",
  note: "a class this card does not know — read B4's digest, do not assume benign",
};

function classStyle(name: string) {
  return CLASS_STYLE[name] ?? { ...UNKNOWN_CLASS, label: `${name} (unknown)` };
}

const PC_STYLE: Record<string, string> = {
  PASS: "text-emerald-300",
  FAIL: "text-red-300",
  PENDING: "text-amber-300",
  UNKNOWN: "text-slate-300",
};

function fmtAge(s: number | null): string {
  if (s === null || !isFinite(s)) return "unknown";
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${(s / 3600).toFixed(1)}h ago`;
}

// A full-card fault banner. Used for every state in which the panel must NOT be
// read as a clean day. Deliberately replaces the body rather than sitting beside
// it — "instead of a green tick, never beside one".
function FaultCard({
  tone, title, body, detail,
}: { tone: string; title: string; body: string; detail?: string | null }) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-label-ui">shadow week</CardTitle>
      </CardHeader>
      <div className={`m-3 rounded-lg border px-3 py-3 ${tone}`}>
        <div className="font-mono text-sm font-bold tracking-wide">{title}</div>
        <div className="mt-1 text-xs leading-relaxed opacity-90">{body}</div>
        {detail ? (
          <div className="mt-2 break-words font-mono text-[11px] opacity-70">{detail}</div>
        ) : null}
      </div>
    </Card>
  );
}

// `initialData` exists ONLY so the render proof can drive this component with a
// real injected payload and assert on the REAL rendered markup rather than on the
// code that is supposed to produce it. Production renders never pass it.
export function ShadowWeekCard({ initialData }: { initialData?: ShadowData } = {}) {
  const [data, setData] = React.useState<ShadowData | null>(initialData ?? null);
  const [loading, setLoading] = React.useState(!initialData);

  React.useEffect(() => {
    if (initialData) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(ENDPOINT, { cache: "no-store" });
        const j = (await r.json()) as ShadowData;
        if (alive) setData(j);
      } catch {
        // A failed fetch is NOT a clean card — fall to the NO_DATA fault below.
        if (alive) {
          setData({
            panel_state: "NO_DATA", reason: "route unreachable from the browser",
            stale: false, row: null, fetch: null,
          });
        }
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [initialData]);

  if (loading && !data) {
    return (
      <Card className="w-full">
        <CardHeader><CardTitle className="text-label-ui">shadow week</CardTitle></CardHeader>
        <div className="p-3"><Skeleton className="h-24 w-full" /></div>
      </Card>
    );
  }
  if (!data) return null;

  // ── Rule 6: a one-sided view renders UNREACHABLE, never green, never omitted.
  if (data.panel_state === "UNREACHABLE") {
    return (
      <FaultCard
        tone="border-orange-500/60 bg-orange-500/10 text-orange-200"
        title="⚠ UNREACHABLE — ghostbox could not be read"
        body="The shadow instance's monitor could not be reached, so this is a ONE-SIDED view. It is not evidence of agreement and must not be read as a clean day."
        detail={data.fetch?.error ?? data.reason}
      />
    );
  }

  // ── Rule: stale renders as a FAULT, not as an empty card and not as last-known
  //    values. A stopped monitor and a clean week look identical otherwise.
  if (data.panel_state === "STALE") {
    return (
      <FaultCard
        tone="border-red-500/60 bg-red-500/10 text-red-200"
        title="⚠ STALE — the monitor has stopped writing"
        body="B4 has not written a panel inside its 28h threshold. THE MONITOR IS THE THING THAT STOPPED — this is not a clean week."
        detail={data.reason}
      />
    );
  }

  // ── Rule 5: NO DATA is its own state, never a clean day.
  if (data.panel_state === "NO_DATA" || !data.row) {
    return (
      <FaultCard
        tone="border-slate-400/60 bg-slate-500/10 text-slate-200"
        title="⏸ NO DATA — the shadow week has not started"
        body="Nothing has been compared yet. This is NOT a clean day and NOT a pass; it is the absence of evidence. The shadow begins at C5."
        detail={data.reason}
      />
    );
  }

  const row = data.row;
  const harnessRunning = row.harness_state === "RUNNING";
  const notDrift = Object.entries(row.not_drift ?? {}).filter(([, n]) => n > 0);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-label-ui">shadow week</CardTitle>
      </CardHeader>

      <div className="space-y-3 p-3">
        {/* ── Rule 2: harness_state outranks EVERYTHING. When it is not RUNNING it
            replaces the day counter rather than sitting next to it. */}
        {!harnessRunning ? (
          <div className="rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-amber-200">
            <div className="font-mono text-sm font-bold">
              ⏸ HARNESS {row.harness_state}
            </div>
            <div className="mt-1 text-xs leading-relaxed opacity-90">
              Nothing is comparing the two instances, so the day counter below is
              not evidence of agreement. Read this line first.
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 font-mono text-sm text-emerald-300">
            ▶ HARNESS RUNNING · heartbeat {fmtAge(row.last_heartbeat_age_s)}
          </div>
        )}

        {/* ── Day counter. Rule 3: HOLD is its own state, never CLEAN. */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-sm">
          <span className="opacity-70">day</span>
          <span className="text-base font-bold">
            {row.clean_days}/{row.target_days}
          </span>
          <span className="opacity-70">clean ·</span>
          <span
            className={
              row.day_state === "CLEAN"
                ? "font-bold text-emerald-300"
                : row.day_state === "RESET"
                ? "font-bold text-red-300"
                : "font-bold text-amber-300"
            }
          >
            today {row.day_state}
          </span>
        </div>
        {row.day_cause ? (
          <div className="text-xs leading-relaxed opacity-70">{row.day_cause}</div>
        ) : null}

        {/* ── Section 2: DRIFT, alone. Rule 1 — this number is drift_count and
            nothing else is ever added into it. */}
        <div className="rounded-lg border border-white/10 px-3 py-2">
          <div className="mb-1 text-[11px] uppercase tracking-wider opacity-60">
            disagreement
          </div>
          {row.drift_count > 0 ? (
            <div className={`inline-flex items-center gap-2 rounded-md border px-2 py-1 font-mono text-sm ${classStyle("DRIFT").cls}`}>
              <span>{classStyle("DRIFT").glyph}</span>
              <span className="font-bold">DRIFT ×{row.drift_count}</span>
            </div>
          ) : (
            <div className="font-mono text-sm text-emerald-300">✅ drift: none</div>
          )}
        </div>

        {/* ── Section 3: everything that is NOT a disagreement. Rule 1 again —
            these are styled unmistakably differently from the drift line, and
            each class is visually distinct from the others. */}
        <div className="rounded-lg border border-white/10 px-3 py-2">
          <div className="mb-1.5 text-[11px] uppercase tracking-wider opacity-60">
            not a disagreement — resource / visibility
          </div>
          {notDrift.length === 0 ? (
            <div className="font-mono text-xs opacity-60">none reported</div>
          ) : (
            <div className="space-y-1.5">
              {notDrift.map(([name, n]) => {
                const s = classStyle(name);
                return (
                  <div
                    key={name}
                    className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border px-2 py-1 ${s.cls}`}
                  >
                    <span aria-hidden>{s.glyph}</span>
                    <span className="font-mono text-xs font-bold">
                      {s.label} ×{n}
                    </span>
                    <span className="w-full text-[11px] opacity-80 xs:w-auto">
                      {s.note}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── The eight pass conditions. PENDING and UNKNOWN are never a pass. */}
        <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
          {(row.pass_conditions ?? []).map((pc) => (
            <span
              key={pc.id}
              title={`${pc.id}: ${pc.status}${pc.last_fail_day ? ` (last fail ${pc.last_fail_day})` : ""}`}
              className={`rounded border border-white/10 px-1.5 py-0.5 ${PC_STYLE[pc.status] ?? "text-slate-300"}`}
            >
              {pc.id} {pc.status === "PASS" ? "✅" : pc.status === "FAIL" ? "❌" : pc.status === "PENDING" ? "⏳" : "❓"}
            </span>
          ))}
        </div>

        <div className="border-t border-white/10 pt-2 font-mono text-[10px] leading-relaxed opacity-50">
          B4 panel {row.generated_at_et} ({row.tz_asserted}) · {fmtAge(row.age_s)}
          <br />
          summary only — the canonical artifact is ghostbox
          b4mon/var/digest/&lt;ET-date&gt;.txt
        </div>
      </div>
    </Card>
  );
}

export default ShadowWeekCard;
