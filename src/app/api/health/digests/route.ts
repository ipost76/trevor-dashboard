import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// B7 — Hub Activity/Digest feed, LIST endpoint.
//
// Serves the card-preview fields for the nightly digests (built VM-side by
// B1-B6) out of the `digest` table in the READ-ONLY litestream replica, via
// query_digest.py (`mode=ro`). Newest digest_date first. body_md is NOT in this
// payload — the 8 KB+ document is fetched only when a card is expanded.
//
// Auth: /api/health/* is auth-gated. middleware.ts allowlists the liveness
// probe by EXACT match on "/api/health" only, so this sub-route stays gated
// like /api/health/ai-findings.
//
// Never 500s: a replica mid-restore, an absent table, or a python throw all
// return the FALLBACK shape at HTTP 200 so the feed renders an empty state
// rather than blanking the Health page.

interface DigestPreview {
  digest_date: string;
  generated_at: string | null;
  headline_pnl_usd: number | null;
  equity_usd: number | null;
  equity_delta_1d: number | null;
  trades_closed_24h: number | null;
  commits_24h: number | null;
  errors_24h: number | null;
  config_changes_24h: number | null;
  top_severity: string | null;
  level: number | null;
  prior_digest_age_h: number | null;
  schema_version: number | null;
}

interface DigestListResponse {
  digests: DigestPreview[];
  total: number;
  returned: number;
  limit: number;
  table_present: boolean;
  replica_age_seconds?: number | null;
  replica_mtime?: string | null;
  error?: string;
}

const FALLBACK: DigestListResponse = {
  digests: [],
  total: 0,
  returned: 0,
  limit: 60,
  table_present: false,
};

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("limit");
  const parsed = Number.parseInt(raw ?? "", 10);
  const limit = Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 365)) : 60;

  try {
    const stdout = await runPython("query_digest.py", ["list", String(limit)], {
      timeout: 8_000,
    });
    const data = safeJsonParse<DigestListResponse>(stdout, {
      ...FALLBACK,
      limit,
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ...FALLBACK, limit, error: String(err) },
      { status: 200 },
    );
  }
}
