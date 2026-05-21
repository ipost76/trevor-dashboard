import { NextRequest, NextResponse } from "next/server";
import { readFileSync, statSync } from "fs";
import { runPython } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const filename = decodeURIComponent(rawFilename ?? "");
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
    const stdout = runPython("convert_md_to_pdf.py", [filename], {
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
