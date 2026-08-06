"use client";
import * as React from "react";

// MemoryLivenessLine — the R11 liveness LINE at the top of the TRAINER page
// (R12-B1, decision 7). A LINE, NOT an alarm. Reads /api/trainer/memory-liveness
// (memory.db, WSL-local).
//
// 🚨 THREE WORLDS, THREE LINES. This used to render `data?.entries ?? 0` and
// nothing else, so a successful read of an empty store, a store that had never
// been built, and a fetch that threw were all displayed as the same confident
// `0`. An empty store IS the expected pre-cutover state — but "I read it and it
// is empty" and "I could not read it" are different facts and must not share a
// rendering. The API's `status` now reports the READ rather than the count, and
// this component branches on it.

// 🚨 A FOURTH WORLD (RM-TRAINER-B4): the store was read fine and NOTHING IS WIRED TO
// WRITE IT. Every table behind `entries`/`tiers` is written only when
// MEMORY_REASONING_ENABLED is on, and that flag is off by design until there is
// something to project. Rendering `0 things remembered · 0 hot · 0 warm · 0 cold`
// under that flag reports a SWITCH POSITION as a MEASUREMENT — it reads as "the memory
// layer is running and has learned nothing", which is a different and much worse claim
// than "the memory layer is not switched on yet". Three zeroes under an "off" label
// would be the same false measurement in smaller type, so the counts are withheld
// entirely while the flag is off, and render EXACTLY as before once it is armed —
// including a genuine 0, which then IS a measurement.

type LivenessStatus = "ok" | "no_data_yet" | "unavailable";

interface Liveness {
  status: LivenessStatus;
  entries: number;
  tiers: { H: number; W: number; C: number };
  // Absent = UNKNOWN, never "off". Only a strict `false` suppresses the counts; a
  // payload that lost the key must fall through to the old rendering rather than let
  // this component assert a switch position nothing told it about.
  memory_projection_enabled?: boolean;
  // The projection's two source tables (rejection_log + standing_hypotheses).
  // 🚨 null = unreadable, which is NOT zero — the copy stays silent about the sources
  // rather than claim "nothing to project" on a read that never happened.
  source_rows?: number | null;
  error?: string;
}

const UNAVAILABLE: Liveness = {
  status: "unavailable",
  entries: 0,
  tiers: { H: 0, W: 0, C: 0 },
  source_rows: null,
};

export function MemoryLivenessLine() {
  const [data, setData] = React.useState<Liveness | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/trainer/memory-liveness", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) {
          setData(await res.json());
        } else {
          // A non-ok response is a failed read, not an empty store. Leaving the
          // state null here is what let `?? 0` speak for a 401 or a 500.
          setData(UNAVAILABLE);
        }
      } catch {
        if (!cancelled) setData(UNAVAILABLE);
      }
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Before the first response lands we know nothing — say nothing.
  if (data === null) return null;

  const readable = data.status === "ok";

  // A failed read still outranks the switch position: "couldn't be read" is a fault that
  // needs surfacing, while a flag being off by design is not. Below that, the flag wins —
  // when it is off it EXPLAINS the empty store rather than competing with it.
  const projectionOff =
    data.status !== "unavailable" && data.memory_projection_enabled === false;

  // Info/neutral only. A deliberate off-switch is not a warning, so nothing here reaches
  // for gold or red — the dot drops to the neutral fg-muted and the text keeps the line's
  // existing muted treatment.
  const dotClass = projectionOff
    ? "bg-fg-muted"
    : readable
      ? "bg-accent-cyan-soft"
      : "bg-fg-faint";

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-micro text-fg-muted">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-pill ${dotClass}`} />
      {projectionOff ? (
        <span>
          Memory projection is off — nothing is wired to write memories yet
          {data.source_rows === 0
            ? ", and there is nothing to project."
            : typeof data.source_rows === "number" && data.source_rows > 0
              ? ` (${data.source_rows} ${data.source_rows === 1 ? "row" : "rows"} waiting).`
              : "."}
        </span>
      ) : data.status === "ok" ? (
        <>
          <span>
            Memory: <span className="font-mono text-fg-primary">{data.entries}</span>{" "}
            {data.entries === 1 ? "thing remembered" : "things remembered"}
          </span>
          <span className="text-fg-faint">·</span>
          <span className="font-mono">
            {data.tiers.H} hot · {data.tiers.W} warm · {data.tiers.C} cold
          </span>
        </>
      ) : data.status === "no_data_yet" ? (
        <span>Memory: nothing stored yet</span>
      ) : (
        <span>Memory: couldn&apos;t be read</span>
      )}
    </div>
  );
}
