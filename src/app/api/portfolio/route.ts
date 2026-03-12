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
      `${pythonPath} ${scriptPath} "${dbPath}" open`,
      { encoding: "utf-8", timeout: 10000, cwd: trevorDir }
    ).trim();
    return NextResponse.json(JSON.parse(result));
  } catch (e) {
    return NextResponse.json({
      stocks_etfs: [], crypto_spot: [], crypto_perps: [],
      summary: {
        total_value: 0, total_unrealized_pnl: 0, total_unrealized_pnl_pct: 0,
        position_count: 0, by_category: {},
      },
    });
  }
}
