import { NextResponse } from "next/server";
import os from "os";
import { getEventLoopLag } from "@/lib/event-loop-lag";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// p99 event-loop-delay above this (ms) reflects a wedge → surface `degraded`.
// Dormant signal today: the watchdog reads only the HTTP code and treats a 200
// `degraded` as healthy (no restart). Wired for future body-parsing consumers.
const LAG_DEGRADED_P99_MS = 250;

// REL-14 (2026-06-02): max event-loop-delay above this (ms) ALSO flips
// `degraded`. `max_ms` is cumulative since process start, so a single wedge
// spike >1s LATCHES degraded for the rest of this process's life — the machine-
// readable "a wedge happened this lifetime" proof for REL-01's success metric.
// Safe with the watchdog (it reads the HTTP code only and treats a 200/degraded
// as healthy), so a latched degraded never triggers a restart loop.
const LAG_DEGRADED_MAX_MS = 1000;

// RHR-02 (2026-06-03): boot-grace window for the max_ms latch. A routine Next.js
// cold-start spike (~1.7-2.5s vs ~13ms healthy p99) trips the max_ms latch the
// instant the process boots, and because `max_ms` is cumulative since process
// start that boot spike LATCHES `degraded` for the entire rest of the process
// life — poisoning the signal even though the event loop is healthy. Fix: ignore
// max_ms latching for the first LAG_BOOT_GRACE_SEC, then reset the shared
// histogram's cumulative high-water mark ONCE so the latch thereafter sees only
// post-warmup lag. A genuine post-warmup wedge >LAG_DEGRADED_MAX_MS still flips
// `degraded` exactly as before — only the cold-start spike is suppressed. (A bare
// uptime gate alone would NOT work: the stale boot-spike max persists in the
// cumulative histogram, so it would just re-trip the latch the moment the window
// closes. The one-time reset is what actually clears the boot spike.)
const LAG_BOOT_GRACE_SEC = 30;
let lagBootGraceCleared = false;

// REL-09 (2026-06-02): liveness probe ONLY — no filesystem syscall. The probe
// returning 200 *is* the liveness signal: a wedged event loop never reaches this
// handler, so the watchdog restarts on the HTTP timeout. The prior fs.statSync /
// fs.accessSync on the 974MB trevor.db blocked the loop synchronously and would
// HANG the health check on a slow/hung FS — the exact failure a health check
// must survive. DB presence + health live in /api/system-health + /api/heartbeat;
// nothing reads this body (watchdog reads the HTTP code only), so the prior
// `database` block was dropped rather than report an unverified value.
export async function GET() {
  const startTime = performance.now();

  // System resources (Node.js built-in — zero cost, no I/O)
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);

  // RHR-02 boot-grace: while still warming up, the max_ms latch is suppressed so
  // the cold-start spike can't poison it. At the first request past the window we
  // reset the shared histogram ONCE (clearing the cumulative boot-spike max) so the
  // post-grace latch evaluates only post-warmup lag. Reaches the histogram via the
  // same globalThis key event-loop-lag.ts stashes it under; reset() is a perf_hooks
  // IntervalHistogram method — optional-chained so a missing/old instance is a no-op.
  const inBootGrace = process.uptime() < LAG_BOOT_GRACE_SEC;
  if (!inBootGrace && !lagBootGraceCleared) {
    const h = (globalThis as { __trevorEloopDelay?: { reset?: () => void } })
      .__trevorEloopDelay;
    h?.reset?.();
    lagBootGraceCleared = true;
  }

  // Event-loop-delay percentiles (ms) from the single process-wide histogram.
  const eventLoop = getEventLoopLag();
  const highLag =
    eventLoop.p99_ms > LAG_DEGRADED_P99_MS ||
    (!inBootGrace && eventLoop.max_ms > LAG_DEGRADED_MAX_MS);

  // REL-14: restart_count is the systemd NRestarts captured once at boot by
  // server.js (globalThis) — a plain in-memory read, so this route stays instant
  // + non-blocking (REL-09 preserved: no per-request subprocess, no syscall).
  // null until the boot capture lands / if systemctl was unavailable.
  const rc = (globalThis as { __trevorRestartCount?: number | null })
    .__trevorRestartCount;
  const restartCount = typeof rc === "number" ? rc : null;

  const elapsed = Math.round(performance.now() - startTime);

  return NextResponse.json({
    status: highLag ? "degraded" : "healthy",
    timestamp: new Date().toISOString(),
    response_ms: elapsed,
    restart_count: restartCount,
    system: {
      memory_percent: memPercent,
      memory_free_mb: Math.round(freeMem / 1024 / 1024),
      node_uptime_seconds: Math.round(process.uptime()),
    },
    event_loop: eventLoop,
  });
}
