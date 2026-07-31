import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// B7 — Hub Activity/Digest feed, DETAIL endpoint.
//
// Returns body_md + parsed metrics_json for ONE digest_date, backing the
// expand-inline full view. Read-only via query_digest.py (`mode=ro`) against
// the litestream replica.
//
// `date` is validated to a strict YYYY-MM-DD shape before it reaches Python.
// runPython spawns with an argv array (no shell), so this is defence in depth
// rather than the only guard — but an unbounded string has no business
// reaching a DB parameter either.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface DigestDetailResponse {
  found: boolean;
  table_present: boolean;
  digest_date: string;
  generated_at?: string | null;
  body_md: string | null;
  metrics: unknown;
  top_severity?: string | null;
  level?: number | null;
  schema_version?: number | null;
  replica_age_seconds?: number | null;
  replica_mtime?: string | null;
  error?: string;
}

function fallbackFor(date: string): DigestDetailResponse {
  return {
    found: false,
    table_present: false,
    digest_date: date,
    body_md: null,
    metrics: null,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date: rawDate } = await params;
  const date = decodeURIComponent(rawDate ?? "");

  if (!DATE_RE.test(date)) {
    return NextResponse.json(
      { ...fallbackFor(date), error: "invalid date (expected YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  try {
    const stdout = await runPython("query_digest.py", ["detail", date], {
      timeout: 8_000,
    });
    const data = safeJsonParse<DigestDetailResponse>(stdout, fallbackFor(date));
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ...fallbackFor(date), error: String(err) },
      { status: 200 },
    );
  }
}
