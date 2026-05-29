import { NextResponse } from "next/server";
import os from "os";
import fs from "fs";
import { getEventLoopLag } from "@/lib/event-loop-lag";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DB_PATH = process.env.TREVOR_DB_PATH || "/home/trevor/trevor/trevor.db";

// p99 event-loop-delay above this (ms) reflects a wedge → surface `degraded`.
// Dormant signal today: the watchdog reads only the HTTP code and treats a 200
// `degraded` as healthy (no restart). Wired for future body-parsing consumers.
const LAG_DEGRADED_P99_MS = 250;

export async function GET() {
  const startTime = performance.now();

  // DB connectivity: verify files exist and are readable (no subprocess)
  let dbOk = false;
  let dbSizeKb = 0;
  try {
    fs.accessSync(DB_PATH, fs.constants.R_OK);
    dbOk = true;
    dbSizeKb = Math.round(fs.statSync(DB_PATH).size / 1024);
  } catch {
    // DB file not accessible
  }

  // System resources (Node.js built-in — zero cost)
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);

  // Event-loop-delay percentiles (ms) from the single process-wide histogram.
  const eventLoop = getEventLoopLag();
  const highLag = eventLoop.p99_ms > LAG_DEGRADED_P99_MS;

  const elapsed = Math.round(performance.now() - startTime);

  return NextResponse.json({
    status: dbOk && !highLag ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    response_ms: elapsed,
    database: {
      trevor_db: dbOk,
      trevor_db_size_kb: dbSizeKb,
    },
    system: {
      memory_percent: memPercent,
      memory_free_mb: Math.round(freeMem / 1024 / 1024),
      node_uptime_seconds: Math.round(process.uptime()),
    },
    event_loop: eventLoop,
  });
}
