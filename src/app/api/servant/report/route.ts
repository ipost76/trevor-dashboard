import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/servant/report — streams the current rolling SERVANT report (.md) as a
// download (B5 "Download report" button).
//
// The markdown comes from query_servant_report.py (mode=ro, READ-ONLY replica):
// B4's generate_rolling_md output is written to servant_report_state.state_json
// and streamed verbatim; until B4 writes it, the helper regenerates the report
// from open servant_findings. Reuses the contentTypeFor + Content-Disposition
// idiom from the intel downloads / ai-findings recon routes — NO download_manager.
//
// Auth-gated by middleware.ts like every other /api/* route.
// ─────────────────────────────────────────────────────────────────────────────

interface ReportResult {
  markdown: string;
  source: "state_json" | "regenerated" | "empty";
  filename: string;
  open_count: number;
  error: string | null;
}

// recon filenames are DB/helper-sourced — sanitize before the header.
function safeFilename(raw: string | null | undefined): string {
  const cleaned = (raw ?? "")
    .replace(/[\r\n"\\/]/g, "")
    .replace(/\.\.+/g, ".")
    .trim();
  return cleaned || "servant_report.md";
}

export async function GET() {
  let result: ReportResult;
  try {
    const stdout = await runPython("query_servant_report.py", [], { timeout: 8_000 });
    result = safeJsonParse<ReportResult>(stdout, {
      markdown: "",
      source: "empty",
      filename: "servant_report.md",
      open_count: 0,
      error: "no output",
    });
  } catch (err) {
    return new NextResponse("report unavailable: " + String(err), { status: 503 });
  }

  // Only a hard read failure (no markdown at all) is an error; an empty-but-valid
  // report ("no open edges") is legitimate content and still downloads.
  if (result.error && (!result.markdown || result.markdown.length === 0)) {
    return new NextResponse("SERVANT report unavailable: " + result.error, { status: 503 });
  }

  const body = Buffer.from(result.markdown ?? "", "utf-8");
  const filename = safeFilename(result.filename);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
