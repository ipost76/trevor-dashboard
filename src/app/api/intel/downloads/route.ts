import { NextRequest, NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FILTERS = new Set(["all", "active", "archived"]);
// Category ids are lowercase slugs; "uncategorized" selects files with no
// category. An invalid ?category= value is ignored (falls back to all files).
const VALID_CATEGORY = /^[a-z0-9-]+$/;

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "all";
  const filter = ALLOWED_FILTERS.has(status) ? status : "all";
  const categoryParam = req.nextUrl.searchParams.get("category");
  const category =
    categoryParam && VALID_CATEGORY.test(categoryParam) ? categoryParam : null;
  try {
    // No ?category= → original unfiltered listing, unchanged. A valid
    // ?category= (incl. "uncategorized") → category-filtered listing. Either
    // way every file carries its category_id (manifest field, Wave A backend).
    const stdout = category
      ? await runPython("query_docs_categories.py", ["list-by-category", category, filter])
      : await runPython("query_downloads.py", ["list", filter]);
    const data = JSON.parse(stdout);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=30, must-revalidate" },
    });
  } catch (err) {
    return NextResponse.json(
      { files: [], stats: { active_count: 0, archive_count: 0, total_size_mb: 0 }, filter, error: String(err) },
      { status: 200 },
    );
  }
}
