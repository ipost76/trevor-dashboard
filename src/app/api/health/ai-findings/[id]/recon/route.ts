import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/health/ai-findings/[id]/recon
//
// Streams a single finding's recon_md (the AI deep-dive document) as a download.
// The markdown lives INLINE in the ai_findings.recon_md column — read READ-ONLY
// from the litestream replica via query_ai_findings.py (mode=ro). This storage is
// entirely separate from the bottom-nav DOCS file surface: no shared module,
// route, or storage — the recon doc never touches the downloads/ tree.
//
// Reuses the contentTypeFor + Content-Disposition header idiom from the intel
// downloads route (extension-driven content type, attachment disposition).
//
// Auth-gated by middleware.ts (the /api/health liveness allowlist is exact-match,
// so this sub-route requires the session cookie).
// ─────────────────────────────────────────────────────────────────────────────

function contentTypeFor(ext: string): string {
  switch (ext) {
    case "md":
      return "text/markdown; charset=utf-8";
    case "txt":
    case "log":
      return "text/plain; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

// recon_md_filename is DB-sourced — sanitize before it reaches the
// Content-Disposition header (strip quotes / path separators / control chars).
function safeFilename(raw: string | null, id: number): string {
  const cleaned = (raw ?? "")
    .replace(/[\r\n"\\/]/g, "")
    .replace(/\.\.+/g, ".")
    .trim();
  return cleaned || `ai-finding-${id}.md`;
}

interface ReconResult {
  id: number | null;
  found: boolean;
  recon_md?: string;
  recon_md_filename?: string | null;
  title?: string | null;
  created_at?: string | null;
  error?: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = Number.parseInt(String(rawId ?? "").trim(), 10);
  if (!Number.isInteger(id) || id <= 0) {
    return new NextResponse("invalid id", { status: 400 });
  }

  let result: ReconResult;
  try {
    const stdout = await runPython("query_ai_findings.py", ["recon", String(id)], {
      timeout: 8_000,
    });
    result = safeJsonParse<ReconResult>(stdout, { id, found: false });
  } catch (err) {
    return new NextResponse("lookup error: " + String(err), { status: 500 });
  }

  if (!result.found) {
    return new NextResponse("not found", { status: 404 });
  }
  const reconMd = result.recon_md ?? "";
  if (reconMd.length === 0) {
    // The finding exists but carries no recon document.
    return new NextResponse("no recon document for this finding", { status: 404 });
  }

  const filename = safeFilename(result.recon_md_filename ?? null, id);
  const ext = filename.toLowerCase().split(".").pop() ?? "md";
  const body = Buffer.from(reconMd, "utf-8");
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(ext),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
