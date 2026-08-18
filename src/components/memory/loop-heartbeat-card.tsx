"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Pill, Skeleton } from "@/components/ui";
import {
  fmtLoopAge,
  fmtLoopFreshness,
  loopStatePresentation,
  loopsHeadline,
  type LoopRow,
  type LoopsResponse,
} from "./loop-heartbeat-format";

/**
 * [B6] / RM-WATCH — the background-loop heartbeat surface. ONE component, TWO mounts:
 *
 *   <LoopHeartbeatCard />                              /health, every loop
 *   <LoopHeartbeatCard compact loop="trainer_search_loop" />   TRAINER page, one line
 *
 * 🚨 WHY THIS EXISTS. `[B1]` (`ed23440`) made the trainer honest in the database — it now
 * writes `loop_heartbeat.degraded_reason` on every iteration, and clears it symmetrically.
 * `[B1]` then recorded its own open gap: NOTHING ON THE HUB RENDERED IT. Ghost watches the
 * Hub, not `journalctl`, and `[B3]`'s external liveness check is EDGE-TRIGGERED — it alerts
 * on a transition, so a component that has been quietly degraded since before the check
 * existed produces no alert at all. Alerting and displaying are different jobs.
 *
 * 🚨 FOUR STATES THAT MUST NEVER SHARE A COLOUR: healthy · impaired · unknown · not
 * reporting. Plus stopped and parked. The mapping is a total function in
 * loop-heartbeat-format.ts, so a state added later fails the compiler instead of falling
 * through to something reassuring.
 *
 * 🚨 EVERY COUNT IS RENDERED WITH ITS AGE. A bare `iteration_count` is exactly the
 * instrument `[B1]` fixed one layer down — a frozen number that read as a live one for a
 * full day. There is no place on this surface where a number appears without its freshness.
 *
 * READ-ONLY. No control, no mutation, no write. Reads /api/health/loops, which reads the
 * LIVE VM store over the read-only ssh pipe — never the ~19–30 min replica.
 */

interface Props {
  /** Compact single-line variant for the TRAINER page. */
  compact?: boolean;
  /** Restrict to one loop (used with `compact`). */
  loop?: string;
}

/**
 * Cross-poll corroboration of the `unpopulated` verdict.
 *
 * 🚨 The server decides `unpopulated` from a SINGLE poll (`last_error_at` frozen while
 * `last_iteration_at` advances) because the first frame is what Ghost sees and a cross-poll
 * test cannot decide it. This adds the second, independent observation on top: if we watch
 * `iteration_count` climb while `error_count` stands still, we have now SEEN the thing the
 * structural test inferred. It only ever strengthens the message — it can never turn a
 * non-green state green.
 */
interface Witness {
  iterations: number | null;
  errors: number | null;
  itersAdvanced: number;
  errorsAdvanced: number;
}

function witnessLine(w: Witness | undefined): string | null {
  if (!w || w.itersAdvanced <= 0) return null;
  if (w.errorsAdvanced > 0) return null;
  return (
    `Watched since this page opened: ${w.itersAdvanced} more ` +
    `${w.itersAdvanced === 1 ? "run" : "runs"}, and the error count never moved.`
  );
}

export function LoopHeartbeatCard({ compact = false, loop }: Props) {
  const [data, setData] = React.useState<LoopsResponse | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  // Keyed by loop_name. Deliberately NOT state we render from — only an annotation.
  const witnesses = React.useRef<Record<string, Witness>>({});

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/health/loops", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) {
          const next = (await res.json()) as LoopsResponse;
          for (const row of next.loops ?? []) {
            const prev = witnesses.current[row.loop_name];
            const iters = row.iteration_count;
            const errs = row.error_count;
            witnesses.current[row.loop_name] = {
              iterations: iters,
              errors: errs,
              itersAdvanced:
                (prev?.itersAdvanced ?? 0) +
                (prev?.iterations != null && iters != null && iters > prev.iterations
                  ? iters - prev.iterations
                  : 0),
              errorsAdvanced:
                (prev?.errorsAdvanced ?? 0) +
                (prev?.errors != null && errs != null && errs > prev.errors
                  ? errs - prev.errors
                  : 0),
            };
          }
          setData(next);
        } else {
          // A non-ok response is a FAILED READ, not an empty system. Never `{loops: []}`
          // under a status the renderer would treat as fine.
          setData({
            status: "unknown",
            source: "vm-live",
            degraded_column: null,
            loops: [],
            rollup: { worst: "unknown", counts: {}, active: 0, total: 0 },
            error: `the Hub returned HTTP ${res.status}`,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setData({
            status: "unknown",
            source: "vm-live",
            degraded_column: null,
            loops: [],
            rollup: { worst: "unknown", counts: {}, active: 0, total: 0 },
            error: `the Hub could not be reached (${String(err).slice(0, 120)})`,
          });
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (compact) {
    return (
      <LoopHeartbeatCompactLine
        data={data}
        loaded={loaded}
        loopName={loop ?? "trainer_search_loop"}
        witnesses={witnesses.current}
      />
    );
  }
  return <LoopHeartbeatBody data={data} loaded={loaded} witnesses={witnesses.current} />;
}

// ── the compact TRAINER-page line ────────────────────────────────────────────────────────
// Sits beside <MemoryLivenessLine/>: "is it remembering?" next to "is it running, and is it
// telling us the truth about that?".
//
// 🚨 EXPORTED ON PURPOSE. The fetching wrapper above cannot be rendered without a live
// pipe, so its states could only ever be argued about. These two take their data as a
// prop, which makes every state DRIVABLE — the same reason watcher-format.ts pulled
// `armingLine` out as a pure function. A screenshot of one state is not evidence of four.
export function LoopHeartbeatCompactLine({
  data,
  loaded,
  loopName,
  witnesses,
}: {
  data: LoopsResponse | null;
  loaded: boolean;
  loopName: string;
  witnesses: Record<string, Witness>;
}) {
  if (!loaded) return null;

  // 🚨 Three distinct not-good outcomes, branched separately: the read failed, the read
  // worked but this loop has no row, or the loop has a row with a state. Collapsing the
  // first two into "unknown" would lose the difference between "we can't see" and "it was
  // never registered".
  if (!data || data.status !== "ok") {
    return (
      <Line
        dot="bg-fg-faint"
        text={`Trainer heartbeat: couldn't be read${data?.error ? ` — ${data.error}` : ""}`}
      />
    );
  }
  const row = data.loops.find((l) => l.loop_name === loopName);
  if (!row) {
    return (
      <Line
        dot="bg-fg-faint"
        text={`Trainer heartbeat: no "${loopName}" row — it has never registered one`}
      />
    );
  }

  const p = loopStatePresentation(row.state);
  const witness = witnessLine(witnesses[row.loop_name]);
  return (
    <Line
      dot={p.dot}
      text={
        `Trainer: ${p.label.toLowerCase()} · ${row.iteration_count ?? "—"} runs · ` +
        // [B2]: `data` carries the build watermark, so the age re-derives on every render
        // instead of reprinting the number that was true when the payload was made.
        `${fmtLoopFreshness(row, data)}` +
        (row.degraded_reason ? ` · ${row.degraded_reason}` : "") +
        (row.state === "unpopulated" ? " · health field blank, not confirmed healthy" : "") +
        (witness ? ` · ${witness}` : "")
      }
    />
  );
}

function Line({ dot, text }: { dot: string; text: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-micro text-fg-muted">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-pill ${dot}`} />
      <span>{text}</span>
    </div>
  );
}

// ── the full /health card ────────────────────────────────────────────────────────────────
export function LoopHeartbeatBody({
  data,
  loaded,
  witnesses,
}: {
  data: LoopsResponse | null;
  loaded: boolean;
  witnesses: Record<string, Witness>;
}) {
  const headline = loopsHeadline(data);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Background Loops</CardTitle>
        {/* The provenance label is part of the reading, not decoration: it is the answer to
            "is this current?" and it is why this card is worth looking at at all. */}
        <Pill tone="neutral" size="sm">
          live · not the replica
        </Pill>
      </CardHeader>

      <div className="space-y-3 p-4">
        <div className={`rounded-md border p-3 ${headline.tone}`}>
          <div className="font-sans text-micro font-semibold text-fg-primary">
            {headline.label}
          </div>
          <p className="font-sans text-micro leading-relaxed text-fg-muted">{headline.body}</p>
        </div>

        {!loaded ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : data && data.status === "ok" && data.loops.length > 0 ? (
          <>
            {/* 🚨 The degraded_reason column can be absent on an older database. That is a
                fourth-state cause in its own right and it is stated, never assumed away. */}
            {data.degraded_column === false && (
              <p className="font-sans text-micro leading-relaxed text-accent-violet">
                This database has no health-reason field, so an impaired loop would look
                identical to a healthy one. Every row below is reported as not confirmed.
              </p>
            )}
            <ul className="space-y-2">
              {data.loops.map((row) => (
                <LoopRowView
                  key={row.loop_name}
                  row={row}
                  data={data}
                  witness={witnesses[row.loop_name]}
                />
              ))}
            </ul>
          </>
        ) : (
          // No EmptyState here on purpose: "nothing to show" and "we could not look" must
          // not share a rendering, and the headline above already says which one this is.
          <p className="font-sans text-micro leading-relaxed text-fg-muted">
            No loop readings are available. The headline above says why.
          </p>
        )}
      </div>
    </Card>
  );
}

// [B2]: takes the whole payload, not just the row — the build watermark lives at payload
// level (it describes the READ, not any one loop) and the age re-derives from it per render.
function LoopRowView({
  row,
  data,
  witness,
}: {
  row: LoopRow;
  data: LoopsResponse | null;
  witness?: Witness;
}) {
  const p = loopStatePresentation(row.state);
  const seen = witnessLine(witness);
  return (
    <li className="rounded-md border border-border-subtle bg-bg-elevated/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-micro text-fg-primary">{row.loop_name}</span>
        <span
          className={`rounded-pill border px-2 py-0.5 font-sans text-micro font-semibold ${p.tone}`}
        >
          {p.label}
        </span>
      </div>
      <p className="mt-1 font-sans text-micro leading-relaxed text-fg-muted">{p.blurb}</p>
      <p className="mt-1 font-sans text-micro leading-relaxed text-fg-dim">{row.detail}</p>
      {/* 🚨 The reason rides on EVERY row that has one, including a stopped loop whose more
          urgent verdict won the pill. Losing it to the headline state would drop the only
          field that says WHAT is wrong. */}
      {row.degraded_reason && row.state !== "degraded" && (
        <p className="mt-1 font-sans text-micro leading-relaxed text-accent-gold">
          It also reports: {row.degraded_reason}
        </p>
      )}
      {seen && (
        <p className="mt-1 font-sans text-micro leading-relaxed text-accent-violet">{seen}</p>
      )}
      <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-micro text-fg-faint">
        <span>{row.iteration_count ?? "—"} runs</span>
        <span>{row.error_count ?? "—"} errors</span>
        <span>{fmtLoopFreshness(row, data)}</span>
        <span>every {fmtLoopAge(row.cadence_seconds)}</span>
      </div>
    </li>
  );
}
