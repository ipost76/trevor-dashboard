import { NextRequest, NextResponse } from "next/server";
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

// POST /api/docs/categories — create a category from { name }.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const name =
    typeof body === "object" && body !== null &&
    typeof (body as { name?: unknown }).name === "string"
      ? (body as { name: string }).name.trim()
      : "";
  if (!name) {
    return NextResponse.json({ error: "missing or empty name" }, { status: 400 });
  }
  try {
    const stdout = await runPython("query_docs_categories.py", ["category-create", name]);
    const data = JSON.parse(stdout);
    if (data.error) {
      return NextResponse.json(data, { status: 400 });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
