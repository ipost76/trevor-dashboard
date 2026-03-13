import { NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET() {
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
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: String(err), overall: { totalTrades: 0 }, calibration: {}, tickerPerformance: [] },
      { status: 500 }
    );
  }
}
