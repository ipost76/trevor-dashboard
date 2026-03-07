import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "active";
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const offset = parseInt(searchParams.get("offset") || "0");

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const dashboardDir = process.cwd();
  const scriptPath = join(dashboardDir, "query_trades.py");

  try {
    const { execSync } = await import("child_process");

    if (scope === "active") {
      const raw = execSync(
        `${pythonPath} ${scriptPath} active`,
        { encoding: "utf-8", timeout: 15000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
      ).trim();
      return NextResponse.json(JSON.parse(raw));
    }

    if (scope === "history") {
      const filters: Record<string, string> = {};
      const ticker = searchParams.get("ticker");
      const outcome = searchParams.get("outcome");
      const direction = searchParams.get("direction");
      if (ticker) filters.ticker = ticker;
      if (outcome) filters.outcome = outcome;
      if (direction) filters.direction = direction;

      const filtersJson = JSON.stringify(filters).replace(/'/g, "'\"'\"'");
      const raw = execSync(
        `${pythonPath} ${scriptPath} history ${limit} ${offset} '${filtersJson}'`,
        { encoding: "utf-8", timeout: 15000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
      ).trim();
      return NextResponse.json(JSON.parse(raw));
    }

    if (scope === "watchlist") {
      const raw = execSync(
        `${pythonPath} ${scriptPath} watchlist`,
        { encoding: "utf-8", timeout: 10000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
      ).trim();
      return NextResponse.json(JSON.parse(raw));
    }

    return NextResponse.json({ error: "Unknown scope. Use ?scope=active|history|watchlist" }, { status: 400 });
  } catch (err) {
    const errMsg = String(err);
    if (scope === "active") {
      return NextResponse.json({ trades: [], stats: {}, recentSignals: [], error: errMsg });
    }
    if (scope === "history") {
      return NextResponse.json({ records: [], total: 0, error: errMsg });
    }
    return NextResponse.json({ items: [], error: errMsg });
  }
}
