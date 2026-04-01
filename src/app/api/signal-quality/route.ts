import { NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

// In-memory cache (60s TTL)
let _sqCache: { data: unknown; ts: number } | null = null;
const SQ_CACHE_TTL = 60_000;

export async function GET() {
  const start = Date.now();

  if (_sqCache && (Date.now() - _sqCache.ts) < SQ_CACHE_TTL) {
    return NextResponse.json({
      ...(_sqCache.data as Record<string, unknown>),
      cached: true,
      latencyMs: Date.now() - start,
    });
  }

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const dashboardDir = process.cwd();
  const scriptPath = join(dashboardDir, "query_signal_quality.py");

  try {
    const { execSync } = await import("child_process");

    const raw = execSync(
      `${pythonPath} ${scriptPath}`,
      {
        encoding: "utf-8",
        timeout: 15000,
        cwd: trevorDir,
        env: { ...process.env, HOME: "/home/trevor" },
      }
    ).trim();

    const data = JSON.parse(raw);
    _sqCache = { data: { ...data, latencyMs: Date.now() - start }, ts: Date.now() };
    return NextResponse.json({ ...data, latencyMs: Date.now() - start });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), overall: { totalTrades: 0 }, calibration: {}, tickerPerformance: [] },
      { status: 500 }
    );
  }
}
