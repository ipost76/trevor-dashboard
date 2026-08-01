import { NextRequest, NextResponse } from "next/server";
import { runPython, safeDecodeSegment } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// B7 — Hub Activity/Digest feed, MARKDOWN DOWNLOAD endpoint.
//
// Serves a digest's body_md verbatim as a .md attachment. Mirrors the Hub's
// established download convention (src/app/api/intel/downloads/[filename]):
// new NextResponse(body, { headers }) with Content-Disposition: attachment and
// Cache-Control: private, no-store — NOT NextResponse.json().
//
// Unlike the Docs downloads this reads no file from disk: the document lives
// in the replica's `digest` table, so there is no path to traverse. The date
// is still shape-validated before it reaches the query.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface DigestDetail {
  found?: boolean;
  body_md?: string | null;
  error?: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date: rawDate } = await params;
  // B4: was a bare decodeURIComponent — `%25` arrives here as `%` and threw
  // URIError, returning a 500 for what is a client error. Same guard as the
  // detail + delete siblings; DATE_RE below is what rejects it, as a 400.
  const date = safeDecodeSegment(rawDate ?? "");

  if (!DATE_RE.test(date)) {
    return new NextResponse("invalid date (expected YYYY-MM-DD)", {
      status: 400,
    });
  }

  let data: DigestDetail;
  try {
    const stdout = await runPython("query_digest.py", ["detail", date], {
      timeout: 8_000,
    });
    data = JSON.parse(stdout) as DigestDetail;
  } catch (err) {
    return new NextResponse("digest read error: " + String(err), {
      status: 500,
    });
  }

  if (data.error) {
    return new NextResponse("digest read error: " + data.error, { status: 500 });
  }
  if (!data.found || !data.body_md) {
    return new NextResponse("no digest for " + date, { status: 404 });
  }

  const filename = `trevor-digest-${date}.md`;
  return new NextResponse(data.body_md, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
