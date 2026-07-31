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

type LivenessStatus = "ok" | "no_data_yet" | "unavailable";

interface Liveness {
  status: LivenessStatus;
  entries: number;
  tiers: { H: number; W: number; C: number };
  error?: string;
}

const UNAVAILABLE: Liveness = {
  status: "unavailable",
  entries: 0,
  tiers: { H: 0, W: 0, C: 0 },
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

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-micro text-fg-muted">
      <span
        aria-hidden
        className={
          readable
            ? "h-1.5 w-1.5 rounded-pill bg-accent-cyan-soft"
            : "h-1.5 w-1.5 rounded-pill bg-fg-faint"
        }
      />
      {data.status === "ok" ? (
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
