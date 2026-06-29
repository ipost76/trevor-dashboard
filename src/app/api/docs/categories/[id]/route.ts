import { NextRequest, NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Category ids are lowercase slugs (see download_manager._slugify).
const VALID_ID = /^[a-z0-9-]+$/;

// PUT /api/docs/categories/[id] — rename a category. The id is never changed.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId ?? "");
  if (!id || !VALID_ID.test(id)) {
    return NextResponse.json({ error: "invalid category id" }, { status: 400 });
  }
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
    const stdout = await runPython("query_docs_categories.py", [
      "category-rename",
      id,
      name,
    ]);
    const data = JSON.parse(stdout);
    if (data.error) {
      return NextResponse.json(data, { status: 404 });
    }
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE /api/docs/categories/[id] — delete a category; its files move to
// Uncategorized. Returns { success, files_moved }.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId ?? "");
  if (!id || !VALID_ID.test(id)) {
    return NextResponse.json({ error: "invalid category id" }, { status: 400 });
  }
  try {
    const stdout = await runPython("query_docs_categories.py", [
      "category-delete",
      id,
    ]);
    const data = JSON.parse(stdout);
    return NextResponse.json(data, { status: data.success ? 200 : 404 });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
