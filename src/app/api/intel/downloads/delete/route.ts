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
    const stdout = await runPython("query_downloads.py", ["delete", filename]);
    const data = JSON.parse(stdout);
    // Loud on the Hub side: the file is gone locally but the Discord message
    // was NOT deleted. Surfaces in `journalctl -u trevor-dashboard.service`.
    // (The 2026-05-31 bug was silent precisely because nothing logged this.)
    if (data && data.success === true && data.discord_deleted === false) {
      console.error(
        `[downloads/delete] LOCAL DELETE OK but DISCORD DELETE FAILED for "${filename}" ` +
          `(msg_id=${data.discord_msg_id ?? "?"}) — message orphaned in #downloads. ` +
          `See /home/trevor/trevor/logs/downloads_delete.log for the reason.`,
      );
    }
    return NextResponse.json(data, { status: data.success ? 200 : 404 });
  } catch (err) {
    return NextResponse.json({ success: false, filename, error: String(err) }, { status: 500 });
  }
}
