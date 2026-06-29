import { NextRequest, NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const filename =
    typeof body === "object" && body !== null && typeof (body as { filename?: unknown }).filename === "string"
      ? (body as { filename: string }).filename
      : "";
  if (!filename || filename.includes("/") || filename.includes("..")) {
    return NextResponse.json({ error: "missing or invalid filename" }, { status: 400 });
  }
  try {
    const stdout = await runPython("query_downloads.py", ["archive", filename]);
    const data = JSON.parse(stdout);
    return NextResponse.json(data, { status: data.success ? 200 : 404 });
  } catch (err) {
    return NextResponse.json({ success: false, filename, error: String(err) }, { status: 500 });
  }
}
