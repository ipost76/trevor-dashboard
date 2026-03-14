import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "active";
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 500);
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
      const search = searchParams.get("search");
      if (ticker) filters.ticker = ticker;
      if (outcome) filters.outcome = outcome;
      if (direction) filters.direction = direction;
      if (search) filters.search = search;

      const filtersJson = JSON.stringify(filters).replace(/'/g, "'\"'\"'");
      const raw = execSync(
        `${pythonPath} ${scriptPath} history ${limit} ${offset} '${filtersJson}'`,
        { encoding: "utf-8", timeout: 15000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
      ).trim();
      const data = JSON.parse(raw);
      return NextResponse.json({ ...data, limit, offset });
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
      return NextResponse.json({ records: [], total: 0, limit, offset, error: errMsg });
    }
    return NextResponse.json({ items: [], error: errMsg });
  }
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, notes, training_status } = body;

  if (id == null) {
    return NextResponse.json({ error: "Missing trade id" }, { status: 400 });
  }

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const scriptPath = join(process.cwd(), "query_trades.py");
  const payload = JSON.stringify({ id, notes, training_status });

  try {
    const { execSync } = await import("child_process");
    const raw = execSync(
      `${pythonPath} ${scriptPath} annotate '${payload.replace(/'/g, "'\"'\"'")}'`,
      { encoding: "utf-8", timeout: 10000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
    ).trim();
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json({ error: String(err), ok: false }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { id, ids } = body;

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const scriptPath = join(process.cwd(), "query_trades.py");

  try {
    const { execSync } = await import("child_process");

    if (Array.isArray(ids) && ids.length > 0) {
      const idsJson = JSON.stringify(ids).replace(/'/g, "'\"'\"'");
      const raw = execSync(
        `${pythonPath} ${scriptPath} bulk_update '${idsJson}' EXCLUDE`,
        { encoding: "utf-8", timeout: 15000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
      ).trim();
      return NextResponse.json(JSON.parse(raw));
    }

    if (id != null) {
      const raw = execSync(
        `${pythonPath} ${scriptPath} delete_trade ${String(id)}`,
        { encoding: "utf-8", timeout: 10000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
      ).trim();
      return NextResponse.json(JSON.parse(raw));
    }

    return NextResponse.json({ error: "Missing id or ids" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err), ok: false }, { status: 500 });
  }
}
