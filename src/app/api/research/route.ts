import { NextRequest, NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "analyses";
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0"), 0);

  try {
    if (scope === "analyses") {
      const filters: Record<string, string> = {};
      const ticker = searchParams.get("ticker");
      const type = searchParams.get("type");
      const search = searchParams.get("search");
      if (ticker) filters.ticker = ticker;
      if (type) filters.type = type;
      if (search) filters.search = search;

      const raw = runPython(
        "query_research.py",
        ["analyses", String(limit), String(offset), JSON.stringify(filters)],
        { timeout: 15000 }
      );
      const data = JSON.parse(raw);
      return NextResponse.json({ ...data, limit, offset });
    }

    if (scope === "insights") {
      const query = searchParams.get("q") || "";
      const collection = searchParams.get("collection") || "market_insights";
      if (!query) {
        return NextResponse.json({ results: [], message: "Provide ?q= to search" });
      }
      const raw = runPython(
        "query_research.py",
        ["insights", query, collection],
        { timeout: 30000 }
      );
      return NextResponse.json(JSON.parse(raw));
    }

    if (scope === "quick") {
      const ticker = searchParams.get("ticker") || "BTC";
      const raw = runPython(
        "query_research.py",
        ["quick", ticker],
        { timeout: 30000 }
      );
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
