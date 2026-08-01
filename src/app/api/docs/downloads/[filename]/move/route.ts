import { NextRequest, NextResponse } from "next/server";
import { runPython, safeDecodeSegment } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUT /api/docs/downloads/[filename]/move — move a file to a category, or to
// Uncategorized when { category_id } is null.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename: rawFilename } = await params;
  // B4: was a bare decodeURIComponent — `%25` arrives here as `%` and threw
  // URIError, returning a 500 for what is a client error. The path checks below
  // reject the malformed value as a 400.
  const filename = safeDecodeSegment(rawFilename ?? "");
  if (
    !filename ||
    filename.includes("/") ||
    filename.includes("..") ||
    filename.startsWith(".")
  ) {
    return NextResponse.json({ error: "invalid filename" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const hasCategory =
    typeof body === "object" && body !== null && "category_id" in body;
  const categoryId: unknown = hasCategory
    ? (body as { category_id: unknown }).category_id
    : undefined;
  if (categoryId !== null && typeof categoryId !== "string") {
    return NextResponse.json(
      { error: "category_id is required and must be a string or null" },
      { status: 400 },
    );
  }
  try {
    const stdout = await runPython("query_docs_categories.py", [
      "file-move",
      filename,
      JSON.stringify(categoryId),
    ]);
    const data = JSON.parse(stdout);
    return NextResponse.json(data, { status: data.success ? 200 : 404 });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
