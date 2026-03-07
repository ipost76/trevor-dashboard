import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "analyses";
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const offset = parseInt(searchParams.get("offset") || "0");

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const dashboardDir = process.cwd();
  const scriptPath = join(dashboardDir, "query_research.py");

  try {
    const { execSync } = await import("child_process");

    if (scope === "analyses") {
      const filters: Record<string, string> = {};
      const ticker = searchParams.get("ticker");
      const type = searchParams.get("type");
      const search = searchParams.get("search");
      if (ticker) filters.ticker = ticker;
      if (type) filters.type = type;
      if (search) filters.search = search;

      const filtersJson = JSON.stringify(filters).replace(/'/g, "'\"'\"'");
      const raw = execSync(
        `${pythonPath} ${scriptPath} analyses ${limit} ${offset} '${filtersJson}'`,
        { encoding: "utf-8", timeout: 15000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
      ).trim();
      const data = JSON.parse(raw);
      return NextResponse.json({ ...data, limit, offset });
    }

    if (scope === "insights") {
      const query = searchParams.get("q") || "";
      const collection = searchParams.get("collection") || "market_insights";
      if (!query) {
        return NextResponse.json({ results: [], message: "Provide ?q= to search" });
      }
      const raw = execSync(
        `${pythonPath} ${scriptPath} insights "${query.replace(/"/g, '\\"')}" "${collection}"`,
        { encoding: "utf-8", timeout: 30000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
      ).trim();
      return NextResponse.json(JSON.parse(raw));
    }

    if (scope === "quick") {
      const ticker = searchParams.get("ticker") || "BTC";
      const raw = execSync(
        `${pythonPath} ${scriptPath} quick "${ticker.replace(/"/g, '\\"')}"`,
        { encoding: "utf-8", timeout: 30000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
      ).trim();
      return NextResponse.json(JSON.parse(raw));
    }

    return NextResponse.json({ error: "Unknown scope. Use ?scope=analyses|insights|quick" }, { status: 400 });
  } catch (err) {
    const errMsg = String(err);
    if (scope === "analyses") {
      return NextResponse.json({ records: [], total: 0, limit, offset, error: errMsg });
    }
    if (scope === "insights") {
      return NextResponse.json({ results: [], error: errMsg });
    }
    return NextResponse.json({ indicators: {}, error: errMsg });
  }
}
