import { NextRequest, NextResponse } from "next/server";
import { readFileSync, statSync } from "fs";
import { runPython, safeDecodeSegment } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  filename: string;
}

function contentTypeFor(ext: string): string {
  switch (ext) {
    case "md":
      return "text/markdown; charset=utf-8";
    case "pdf":
      return "application/pdf";
    case "json":
      return "application/json; charset=utf-8";
    case "txt":
    case "log":
      return "text/plain; charset=utf-8";
    case "csv":
      return "text/csv; charset=utf-8";
    case "html":
    case "htm":
      return "text/html; charset=utf-8";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const { filename: rawFilename } = await params;
  // B4: was a bare decodeURIComponent — `%25` arrives here as `%` and threw
  // URIError, returning a 500 for what is a client error. The malformed value
  // falls through to the path checks below, which reject it as a 400.
  const filename = safeDecodeSegment(rawFilename ?? "");
  if (!filename || filename.includes("/") || filename.includes("..") || filename.startsWith(".")) {
    return new NextResponse("invalid filename", { status: 400 });
  }
  let path: string | null = null;
  try {
    const stdout = await runPython("query_downloads.py", ["path", filename]);
    const data = JSON.parse(stdout) as { path: string | null };
    path = data.path;
  } catch (err) {
    return new NextResponse("lookup error: " + String(err), { status: 500 });
  }
  if (!path) {
    return new NextResponse("not found", { status: 404 });
  }
  try {
    const buf = readFileSync(path);
    const size = statSync(path).size;
    const ext = filename.toLowerCase().split(".").pop() ?? "";
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentTypeFor(ext),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(size),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return new NextResponse("read error: " + String(err), { status: 500 });
  }
}
