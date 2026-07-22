"use client";
import * as React from "react";

// MemoryLivenessLine — the R11 liveness LINE at the top of the TRAINER page
// (R12-B1, decision 7). `memory: N entries · tiers H/W/C`. A LINE, NOT an alarm.
// Reads /api/trainer/memory-liveness (memory.db, WSL-local). The full memory
// query UI is DEFERRED — this is the liveness line only. Empty (0/0/0) is the
// EXPECTED pre-cutover display, never an error.

interface Liveness {
  status: "ok" | "no_data_yet";
  entries: number;
  tiers: { H: number; W: number; C: number };
  error?: string;
}

export function MemoryLivenessLine() {
  const [data, setData] = React.useState<Liveness | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/trainer/memory-liveness", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) setData(await res.json());
      } catch {
        // keep last-good; the line just shows the previous value / dashes
      }
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const entries = data?.entries ?? 0;
  const t = data?.tiers ?? { H: 0, W: 0, C: 0 };

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-micro text-fg-muted">
      <span aria-hidden className="h-1.5 w-1.5 rounded-pill bg-accent-cyan-soft" />
      <span>
        memory: <span className="font-mono text-fg-primary">{entries}</span> entries
      </span>
      <span className="text-fg-faint">·</span>
      <span className="font-mono">
        tiers H{t.H}/W{t.W}/C{t.C}
      </span>
    </div>
  );
}
