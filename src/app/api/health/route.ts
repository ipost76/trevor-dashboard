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

  // Event-loop-delay percentiles (ms) from the single process-wide histogram.
  const eventLoop = getEventLoopLag();
  const highLag =
    eventLoop.p99_ms > LAG_DEGRADED_P99_MS ||
    eventLoop.max_ms > LAG_DEGRADED_MAX_MS;

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
