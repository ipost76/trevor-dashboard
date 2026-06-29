import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/docs/categories — all categories + count of uncategorized files.
// Auth is enforced globally by middleware.ts (401 on a missing/invalid cookie).
export async function GET() {
  try {
    const stdout = await runPython("query_docs_categories.py", ["categories-list"]);
    const data = JSON.parse(stdout);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=30, must-revalidate" },
    });
  } catch (err) {
    return NextResponse.json(
      { categories: [], uncategorized_count: 0, error: String(err) },
      { status: 200 },
    );
  }
}

// [B3] Hub read-only lockdown (2026-06-28): the POST write surface (create docs
// category) was removed. Only the GET read (categories-list) remains — the path
// 405s on a write verb. Server-side kill; UI removal is B1/B2.
