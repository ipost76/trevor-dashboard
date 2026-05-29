import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/auto/activity?limit=&offset=&actor=&source_type=&key=&table_name=
//
// D3 (Activity log) backend. Federated UNION across change_log + 5
// historical audit tables (autotrader_state_audit, aggressive_mode_history,
// filter_rule_changelog, circuit_breaker_trips, close_audit_log), normalized
// into a common shape and returned newest-first. Recent close_audit_log
// rows that are already cross-indexed in change_log are deduped on the
// Python side so each event appears exactly once.
//
// `id` is a composite string `<table_name>:<source_id>` — unique across
// the union; treat as opaque on the client (React key only).
//
// Pagination: limit clamped to [1, 500], default 50. offset >= 0.
// All filter params optional; use `*` or empty string as a wildcard.
//
// READ-ONLY. Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ActivityEntry {
  id: string;
  timestamp: string;
  table_name: string;
  row_id: number | null;
  key: string | null;
  old_value: string | null;
  new_value: string | null;
  actor: string;
  source_type: string;
  session_id: string | null;
  prompt_id: string | null;
  notes: string | null;
}

interface ActivityResponse {
  entries: ActivityEntry[];
  total: number;
  returned: number;
  limit: number;
  offset: number;
  filters: {
    actor: string | null;
    source_type: string | null;
    key: string | null;
    table_name: string | null;
  };
  sources?: string[];
  error?: string;
}

const FALLBACK: ActivityResponse = {
  entries: [],
  total: 0,
  returned: 0,
  limit: 50,
  offset: 0,
  filters: { actor: null, source_type: null, key: null, table_name: null },
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = url.searchParams.get("limit") || "50";
  const offset = url.searchParams.get("offset") || "0";
  const actor = url.searchParams.get("actor") || "";
  const source_type = url.searchParams.get("source_type") || "";
  const key = url.searchParams.get("key") || "";
  const table_name = url.searchParams.get("table_name") || "";

  try {
    const raw = await runPython(
      "query_activity.py",
      [limit, offset, actor, source_type, key, table_name],
      { timeout: 8_000 },
    );
    const data = safeJsonParse<ActivityResponse>(raw, FALLBACK);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ...FALLBACK, error: String(err) },
      { status: 200 },
    );
  }
}
