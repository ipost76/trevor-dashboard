import { NextRequest, NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FILTERS = new Set(["all", "active", "archived"]);

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "all";
  const filter = ALLOWED_FILTERS.has(status) ? status : "all";
  try {
    const stdout = await runPython("query_downloads.py", ["list", filter]);
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
