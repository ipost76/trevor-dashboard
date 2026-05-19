import { NextRequest, NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUT /api/docs/categories/reorder — set category order from { category_ids }.
// category_ids must be exactly the current set of category ids (the Python
// layer rejects a partial or mismatched list).
export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const ids = (body as { category_ids?: unknown } | null)?.category_ids;
  if (!Array.isArray(ids) || !ids.every((i) => typeof i === "string")) {
    return NextResponse.json(
      { error: "category_ids must be an array of strings" },
      { status: 400 },
    );
  }
  try {
    const stdout = await runPython("query_docs_categories.py", [
      "category-reorder",
      JSON.stringify(ids),
    ]);
    const data = JSON.parse(stdout);
    if (data.error) {
      return NextResponse.json(data, { status: 400 });
    }
    return NextResponse.json(data, { status: data.success ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
