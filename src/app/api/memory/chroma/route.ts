import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ChromaDB PersistentClient cold-start ~38s; warm <1s. Cache list responses
// server-side so the first user pays once and subsequent loads are instant.
let _listCache: { data: unknown; ts: number } | null = null;
const LIST_CACHE_TTL = 5 * 60_000;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "list";
  const collection = (url.searchParams.get("collection") ?? "").slice(0, 100);
  const q = (url.searchParams.get("q") ?? "").slice(0, 200);
  const limit = String(Math.max(1, Math.min(25, Number(url.searchParams.get("limit") ?? 10))));

  if (!["list", "peek", "search"].includes(mode)) {
    return NextResponse.json({ error: "invalid mode" }, { status: 400 });
  }
  if (mode !== "list") {
    if (!collection) return NextResponse.json({ error: "collection required" }, { status: 400 });
    if (!/^[a-zA-Z0-9_\-]+$/.test(collection)) {
      return NextResponse.json({ error: "invalid collection name" }, { status: 400 });
    }
  }

  if (mode === "list" && _listCache && Date.now() - _listCache.ts < LIST_CACHE_TTL) {
    return NextResponse.json(_listCache.data, { headers: { "X-Cache": "HIT" } });
  }

  let args: string[];
  if (mode === "list") args = ["list"];
  else if (mode === "peek") args = ["peek", collection, limit];
  else args = ["search", collection, q, limit];

  try {
    const stdout = runPython("query_chroma_browse.py", args, { timeout: 60000 });
    const data = safeJsonParse(stdout, { mode, error: "parse failure" });
    if (mode === "list") _listCache = { data, ts: Date.now() };
    return NextResponse.json(data, mode === "list" ? { headers: { "X-Cache": "MISS" } } : undefined);
  } catch (err) {
    return NextResponse.json({ mode, error: String(err) }, { status: 200 });
  }
}
