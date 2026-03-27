import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

// In-memory cache for training summary (expensive: 15-30s cold, ChromaDB init)
let _summaryCache: { data: unknown; ts: number } | null = null;
const SUMMARY_CACHE_TTL = 300_000; // 5 minutes

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "summary";
  const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500);
  const offset = parseInt(searchParams.get("offset") || "0");

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const dashboardDir = process.cwd();
  const scriptPath = join(dashboardDir, "query_training.py");

  try {
    const { execSync } = await import("child_process");

    if (scope === "summary") {
      // Return cached summary if fresh (avoids 15-30s Python+ChromaDB cold start)
      if (_summaryCache && Date.now() - _summaryCache.ts < SUMMARY_CACHE_TTL) {
        return NextResponse.json(_summaryCache.data, {
          headers: { "X-Cache": "HIT", "Cache-Control": "private, max-age=300" },
        });
      }
      const raw = execSync(
        `${pythonPath} ${scriptPath} summary`,
        {
          encoding: "utf-8",
          timeout: 90000,
          cwd: trevorDir,
          env: { ...process.env, HOME: "/home/trevor" },
        }
      ).trim();
      const parsed = JSON.parse(raw);
      _summaryCache = { data: parsed, ts: Date.now() };
      return NextResponse.json(parsed, {
        headers: { "X-Cache": "MISS", "Cache-Control": "private, max-age=300" },
      });
    }

    if (scope === "records") {
      const filters: Record<string, string> = {};
      const ticker = searchParams.get("ticker");
      const outcome = searchParams.get("outcome");
      const signalType = searchParams.get("signal_type");
      const timeframe = searchParams.get("timeframe");
      const search = searchParams.get("search");
      if (ticker) filters.ticker = ticker;
      if (outcome) filters.outcome = outcome;
      if (signalType) filters.signal_type = signalType;
      if (timeframe) filters.timeframe = timeframe;
      if (search) filters.search = search;

      const filtersJson = JSON.stringify(filters).replace(/'/g, "'\"'\"'");
      const raw = execSync(
        `${pythonPath} ${scriptPath} records ${limit} ${offset} '${filtersJson}'`,
        {
          encoding: "utf-8",
          timeout: 15000,
          cwd: trevorDir,
          env: { ...process.env, HOME: "/home/trevor" },
        }
      ).trim();
      const data = JSON.parse(raw);
      return NextResponse.json({ ...data, limit, offset });
    }

    if (scope === "chroma") {
      const query = searchParams.get("q") || "";
      const collection = searchParams.get("collection") || "training_knowledge";

      if (!query) {
        return NextResponse.json({ results: [], message: "Provide ?q= to search" });
      }

      // Pass query via env var to avoid shell quoting issues
      const raw = execSync(
        `${pythonPath} ${scriptPath} chroma "${query.replace(/"/g, '\\"')}" "${collection}"`,
        {
          encoding: "utf-8",
          timeout: 30000,
          cwd: trevorDir,
          env: { ...process.env, HOME: "/home/trevor" },
        }
      ).trim();
      return NextResponse.json(JSON.parse(raw));
    }

    return NextResponse.json({ error: "Unknown scope. Use ?scope=summary|records|chroma" }, { status: 400 });

  } catch (err) {
    const errMsg = String(err);
    // Return graceful error with scope-appropriate shape
    if (scope === "summary") {
      return NextResponse.json({
        totalRecords: 0, bySource: [], byTable: [], outcomes: {}, winRate: 0, avgConfidence: 0,
        topTickers: [], strategyBreakdown: [], timeframes: [],
        chromaStats: { collections: [], totalDocuments: 0 },
        dateRange: { earliest: null, latest: null }, metadata: {}, distinctTickers: 0,
        rollbackAvailable: false, error: errMsg,
      });
    }
    if (scope === "records") {
      return NextResponse.json({ records: [], total: 0, limit, offset, error: errMsg });
    }
    return NextResponse.json({ results: [], error: errMsg });
  }
}
