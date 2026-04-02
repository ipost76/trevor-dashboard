import { NextResponse } from "next/server";
import os from "os";
import fs from "fs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DB_PATH = process.env.TREVOR_DB_PATH || "/home/trevor/trevor/trevor.db";
const AT_DB_PATH = "/home/trevor/trevor/autotrader/autotrader.db";

export async function GET() {
  const startTime = performance.now();

  // DB connectivity: verify files exist and are readable (no subprocess)
  let dbOk = false;
  let dbSizeKb = 0;
  let atDbOk = false;
  try {
    fs.accessSync(DB_PATH, fs.constants.R_OK);
    dbOk = true;
    dbSizeKb = Math.round(fs.statSync(DB_PATH).size / 1024);
  } catch {
    // DB file not accessible
  }
  try {
    fs.accessSync(AT_DB_PATH, fs.constants.R_OK);
    atDbOk = true;
  } catch {
    // AutoTrader DB not accessible
  }

  // System resources (Node.js built-in — zero cost)
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);

  const elapsed = Math.round(performance.now() - startTime);

  return NextResponse.json({
    status: dbOk ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    response_ms: elapsed,
    database: {
      trevor_db: dbOk,
      trevor_db_size_kb: dbSizeKb,
      autotrader_db: atDbOk,
    },
    system: {
      memory_percent: memPercent,
      memory_free_mb: Math.round(freeMem / 1024 / 1024),
      node_uptime_seconds: Math.round(process.uptime()),
    },
  });
}
