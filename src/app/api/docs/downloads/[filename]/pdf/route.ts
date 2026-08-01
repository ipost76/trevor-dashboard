import { NextRequest, NextResponse } from "next/server";
import { readFileSync, statSync } from "fs";
import { runPython, safeDecodeSegment } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ⚠️ SUPERSEDED — NOT ON THE RENDER PATH.  [B4, 2026-08-01]
//
// The Docs → PDF control no longer calls this route. It now prints client-side
// through the shared print document (components/ui/markdown-print-document.tsx),
// the same mechanism D3/D4 built and verified for the nightly digest — which
// needs no dependencies at all.
//
// 🚨 This route has been DEAD ON THIS BOX for as long as it has existed:
// convert_md_to_pdf.py imports `weasyprint` (and `pygments`) at module top
// level, and MEASURED on WSL 2026-08-01 both are absent —
// `ModuleNotFoundError: No module named 'weasyprint'`. The import fails before
// the script's own try/except can emit its JSON error shape, so runPython
// throws and every call returned 500. Installing them needs root, which the
// `trevor` user does not have (FORTRESS-C4).
//
// LEFT IN PLACE DELIBERATELY, not overlooked: removing it is a behaviour change
// nothing measured asked for, and it is now unreferenced by the UI either way.
// The decode guard below was still applied — a superseded route is not an
// excuse to leave a known 500 reachable.

interface Params {
  filename: string;
}

interface ConvertResult {
  path?: string;
  size?: number;
  cached?: boolean;
  error?: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<Params> },
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
    return new NextResponse("invalid filename", { status: 400 });
  }
  if (!filename.toLowerCase().endsWith(".md")) {
    return new NextResponse("only .md files can be converted", { status: 400 });
  }

  // Worst-case real document (~270 KB / ~2400 table rows / ~200 pages) takes
  // ~40 s on this VM; cache hit is sub-second. 90 s timeout gives headroom
  // for anything users might realistically download. The PDF is then cached
  // under downloads/.pdf_cache/, keyed by filename + source mtime — every
  // subsequent download of the same .md is instant.
  let result: ConvertResult;
  try {
    const stdout = await runPython("convert_md_to_pdf.py", [filename], {
      timeout: 90_000,
    });
    result = JSON.parse(stdout) as ConvertResult;
  } catch (err) {
    return new NextResponse("conversion error: " + String(err), { status: 500 });
  }

  if (result.error === "not found") {
    return new NextResponse("not found", { status: 404 });
  }
  if (result.error) {
    return new NextResponse("conversion error: " + result.error, { status: 500 });
  }
  if (!result.path) {
    return new NextResponse("conversion produced no output", { status: 500 });
  }

  try {
    const buf = readFileSync(result.path);
    const size = statSync(result.path).size;
    const pdfName = filename.replace(/\.md$/i, "") + ".pdf";
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdfName}"`,
        "Content-Length": String(size),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return new NextResponse("read error: " + String(err), { status: 500 });
  }
}
