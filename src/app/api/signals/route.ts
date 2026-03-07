import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const offset = parseInt(searchParams.get("offset") || "0");

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const dashboardDir = process.cwd();
  const scriptPath = join(dashboardDir, "query_trades.py");

  try {
    const { execSync } = await import("child_process");

    const filters: Record<string, string> = {};
    const ticker = searchParams.get("ticker");
    const direction = searchParams.get("direction");
    if (ticker) filters.ticker = ticker;
    if (direction) filters.direction = direction;

    const filtersJson = JSON.stringify(filters).replace(/'/g, "'\"'\"'");
    const raw = execSync(
      `${pythonPath} ${scriptPath} signals ${limit} ${offset} '${filtersJson}'`,
      { encoding: "utf-8", timeout: 15000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
    ).trim();
    const data = JSON.parse(raw);
    return NextResponse.json({ ...data, limit, offset });
  } catch (err) {
    return NextResponse.json({ records: [], total: 0, limit, offset, error: String(err) });
  }
}
