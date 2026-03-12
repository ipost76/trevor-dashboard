import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const dbPath = process.env.TREVOR_DB_PATH || "/home/trevor/trevor/trevor.db";
  const pythonPath = trevorDir + "/venv/bin/python3";
  const dashboardDir = process.cwd();

  try {
    const { execSync } = await import("child_process");
    const scriptPath = dashboardDir + "/query_portfolio.py";
    const result = execSync(
      `${pythonPath} ${scriptPath} "${dbPath}" history`,
      { encoding: "utf-8", timeout: 10000, cwd: trevorDir }
    ).trim();
    return NextResponse.json(JSON.parse(result));
  } catch (e) {
    return NextResponse.json({
      positions: [], total_realized_pnl: 0, total_trades: 0,
      win_count: 0, loss_count: 0,
    });
  }
}
