"use client";
import * as React from "react";
import { Pill, Skeleton } from "@/components/ui";

// B7 (2026-06-22): the single green/amber/red health rollup at the very top of
// the HEALTH page — one glance answers "is anything wrong?".
//
// Rollup = WORST-OF( heartbeat overall_status, max AI-finding severity ) so an
// active high-severity finding shows red/amber even when the heartbeat is green
// (gate-approved). Reuses the EXISTING surfaces — /api/heartbeat (overall_status,
// already fetched by <HeartbeatView>) + the auth-gated /api/health/ai-findings
// (findings WHERE status != 'resolved', already fetched by <AiFindingsPanel>) —
// so there is NO new route. Reuses ui/pill.tsx intents (live/warn/error) — no
// new pill. The AI engine is capped until 2026-07-01 → the findings list is
// empty today → the rollup honestly reads the live heartbeat (green when 'ok').

const HEARTBEAT_URL = "/api/heartbeat";
const FINDINGS_URL = "/api/health/ai-findings";
const POLL_MS = 60_000;

// 0 = ok/healthy, 1 = warning/degraded, 2 = critical. Higher wins.
type Rank = 0 | 1 | 2;

interface HeartbeatShape {
  overall_status?: string | null;
  critical_count?: number | null;
  warning_count?: number | null;
  // B3-RM-PROFIT (2026-08-14): the two fields the RETIRED shape already carried
  // and nothing read. /api/heartbeat's failure path returns
  // `{ observatory: "retired", reason }` — see its RM-DECOM B5 comment. They
  // have been in this component's state since that day; only the render ignored
  // them, which is why an honest UNKNOWN was unreadable for 36 days.
  observatory?: string | null;
  reason?: string | null;
}
interface Finding {
  severity: string | null;
}
interface FindingsShape {
  findings?: Finding[];
}

// heartbeat overall_status value space (heartbeat-view.tsx): "ok"|"warning"|"critical"
function heartbeatRank(status: string | null | undefined): Rank {
  if (status === "critical") return 2;
  if (status === "warning") return 1;
  return 0;
}

// AI-finding severity value space (ai-findings-panel.tsx severityPill):
// critical/error → red, warn/warning → gold, else → neutral.
function severityRank(sev: string | null | undefined): Rank {
  const s = (sev ?? "").toLowerCase();
  if (s === "critical" || s === "error") return 2;
  if (s === "warn" || s === "warning") return 1;
  return 0;
}

const INTENT: Record<Rank, "live" | "warn" | "error"> = {
  0: "live",
  1: "warn",
  2: "error",
};
const WORD: Record<Rank, string> = {
  0: "HEALTHY",
  1: "DEGRADED",
  2: "CRITICAL",
};

export function HealthRollup() {
  const [hb, setHb] = React.useState<HeartbeatShape | null>(null);
  const [hbAvailable, setHbAvailable] = React.useState(true);
  const [findings, setFindings] = React.useState<Finding[]>([]);
  const [loaded, setLoaded] = React.useState(false);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    const [hbRes, aiRes] = await Promise.allSettled([
      fetch(HEARTBEAT_URL, { cache: "no-store", signal }),
      fetch(FINDINGS_URL, { cache: "no-store", signal }),
    ]);

    // Heartbeat — a 502/503 outage (or network throw) means we CANNOT confirm
    // health; never fall back to a false green (handled in the render below).
    if (hbRes.status === "fulfilled" && hbRes.value.ok) {
      try {
        const json = (await hbRes.value.json()) as HeartbeatShape;
        setHb(json);
        // RM-DECOM B5: the /api/heartbeat proxy now returns a 200
        // `{observatory:'retired'}` empty shape (no overall_status) when the
        // Observatory is decommissioned. A retired/empty heartbeat CANNOT confirm
        // health, so treat it as unavailable → the render shows an honest UNKNOWN,
        // never a false green off a missing overall_status.
        setHbAvailable(typeof json.overall_status === "string");
      } catch {
        setHbAvailable(false);
      }
    } else {
      setHbAvailable(false);
    }

    // Findings — unreachable/empty → treat as zero findings (engine capped today).
    if (aiRes.status === "fulfilled" && aiRes.value.ok) {
      try {
        const data = (await aiRes.value.json()) as FindingsShape;
        setFindings(data.findings ?? []);
      } catch {
        setFindings([]);
      }
    } else {
      setFindings([]);
    }

    setLoaded(true);
  }, []);

  React.useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [load]);

  if (!loaded) return <Skeleton className="h-7 w-56" />;

  const hbR: Rank = hbAvailable ? heartbeatRank(hb?.overall_status) : 0;
  const aiMax: Rank = findings.reduce<Rank>(
    (m, f) => (severityRank(f.severity) > m ? severityRank(f.severity) : m),
    0,
  );
  const combined: Rank = hbR >= aiMax ? hbR : aiMax;

  // Can't confirm healthy when the heartbeat is unreachable and nothing else
  // raised a flag → show an honest neutral UNKNOWN, never a false green.
  const unknown = !hbAvailable && combined === 0;

  let detail: string;
  if (combined === 0) {
    detail = "all systems nominal";
  } else if (hbR >= aiMax) {
    // Heartbeat is the (tied) worst subsystem.
    const cc = hb?.critical_count ?? 0;
    const wc = hb?.warning_count ?? 0;
    if (combined === 2 && cc > 0) detail = `heartbeat · ${cc} critical`;
    else if (wc > 0) detail = `heartbeat · ${wc} warning${wc === 1 ? "" : "s"}`;
    else detail = "heartbeat";
  } else {
    // An AI finding is the worst subsystem.
    const n = findings.filter((f) => severityRank(f.severity) === combined).length;
    const note = hbAvailable ? "" : " · heartbeat unavailable";
    detail = `${n} AI finding${n === 1 ? "" : "s"}${note}`;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // B3-RM-PROFIT (2026-08-14) — MAKE THE UNKNOWN LEGIBLE.
  //
  // ✅ THIS BADGE IS NOT BROKEN AND WAS NOT "FIXED". A permanently-UNKNOWN
  // rollup is the CORRECT, designed rendering of a decommissioned health
  // source: the Observatory was deliberately retired on 2026-07-08 (unit
  // masked, never started) and its second input, the AI findings table, died
  // with it. The endpoint returns a `retired` shape precisely so consumers show
  // calm neutral rather than a false green, and `hbAvailable === false` is what
  // makes that happen. 🚨 THE STATE IS UNCHANGED — no replacement source is
  // wired, nothing is synthesised from another signal, the panel is not
  // removed. All of that is G-5 and Ghost has not ruled.
  //
  // What WAS wrong: it had been honest and UNREAD for 36 days, because
  // "retired by design, decision pending" and "the thing is broken" rendered in
  // the identical five words. The reason is now on the badge — and it is the
  // ENDPOINT'S OWN reason string, not one composed here.
  // ───────────────────────────────────────────────────────────────────────────
  const retired = hb?.observatory === "retired";
  const marker = retired
    ? "UNKNOWN · retired by design — decision pending"
    : "UNKNOWN · health source unavailable";
  // Verbatim from the payload. If the endpoint stops sending one, the line is
  // omitted rather than replaced by something invented.
  const reasonLine =
    typeof hb?.reason === "string" && hb.reason.trim() !== "" ? hb.reason.trim() : null;

  return (
    <div aria-live="polite">
      <div className="flex items-center gap-2">
        <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
          System health
        </span>
        {unknown ? (
          <Pill tone="neutral" size="md">
            {marker}
          </Pill>
        ) : (
          <Pill intent={INTENT[combined]} size="md" pulse={combined === 2}>
            {WORD[combined]} · {detail}
          </Pill>
        )}
      </div>
      {unknown && reasonLine ? (
        <p className="mt-1 font-mono text-micro leading-relaxed text-fg-muted">
          {reasonLine}
        </p>
      ) : null}
    </div>
  );
}
