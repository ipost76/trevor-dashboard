import { NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

// Cache KB stats for 5 minutes (ChromaDB init is expensive)
let _kbStatsCache: { data: unknown; ts: number } | null = null;
const KB_STATS_CACHE_TTL = 300_000;

export async function GET() {
  if (_kbStatsCache && Date.now() - _kbStatsCache.ts < KB_STATS_CACHE_TTL) {
    return NextResponse.json(_kbStatsCache.data, {
      headers: { "X-Cache": "HIT", "Cache-Control": "private, max-age=300" },
    });
  }

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const chromaDir = join(trevorDir, "vectordb");

  try {
    const { execSync } = await import("child_process");
    const pythonPath = join(trevorDir, "venv", "bin", "python3");

    // Use direct chromadb client instead of KnowledgeBase (avoids sentence-transformer load)
    const pyScript = `
import json, sys, os
sys.path.insert(0, "${trevorDir}")
try:
    import chromadb
    c = chromadb.PersistentClient(path="${chromaDir}")
    cols = c.list_collections()
    result = {"collections": [], "total_entries": 0}
    for col in cols:
        cnt = col.count()
        result["collections"].append({"name": col.name, "count": cnt})
        result["total_entries"] += cnt
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"total_entries": 0, "error": str(e)}))
`;
    const raw = execSync(
      `${pythonPath} -c '${pyScript.replace(/'/g, "'\"'\"'")}'`,
      { encoding: "utf-8", timeout: 15000, cwd: trevorDir }
    ).trim();

    const data = JSON.parse(raw);
    _kbStatsCache = { data, ts: Date.now() };
    return NextResponse.json(data, {
      headers: { "X-Cache": "MISS", "Cache-Control": "private, max-age=300" },
    });
  } catch (err) {
    return NextResponse.json({ total_entries: 0, error: String(err) }, { status: 500 });
  }
}
