import { NextRequest, NextResponse } from "next/server";
import { runPython, runPythonResult, safeJsonParse } from "@/lib/api-helpers";

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

// ─────────────────────────────────────────────────────────────────────────────
// DELETE — the Hub's FIRST write path to the live trevor.db  [D2, 2026-07-31]
//
// Authority: BEHAVIOR_RULES Rule 15 exception #2 (Ghost-directed, 2026-07-31,
// D1) — `digest` only, an observability artifact read by nothing on the trading
// path. Bounded DELETEs by named `digest_date` are permitted; an unbounded
// `DELETE FROM digest` is not. The exception NEVER GENERALIZES.
//
// 🚨 The write does NOT go to the replica. /home/ghost/trevor-replica/trevor.db
// is 0444 (a DELETE there raises "attempt to write a readonly database") AND is
// republished wholesale by trevor-tailsync every ~20 min, so a replica write
// would silently revert and the row would reappear. set_digest_delete.py reaches
// the VM LIVE db over the `ssh vm` pipe — the sanctioned mechanism already in
// production for set_ai_command.py, on this same /api/health/* namespace.
//
// Why not the two-hop :3939 → :3940 gateway (recorded so this is not "fixed"
// later by rerouting it): the gateway is a FIXED op allowlist, each op bound to
// a helper file that must exist ON THE VM. `digest.delete` returns `unknown op`
// (400, measured live). Adding it is VM-side work. The gateway IS the cleaner
// long-term home — it buys a flag gate and a mandatory idempotency key, neither
// of which this path has — so if the Hub grows more write paths, move this one
// there rather than adding a second ssh-shaped writer.
//
// Auth: middleware.ts allowlists the liveness probe by EXACT match on
// "/api/health", so this sub-route is session-gated. An unauthenticated DELETE
// gets 401 before the handler is ever reached (verified live).
//
// 🚨 Every outcome is DISTINGUISHABLE by both HTTP status and the `outcome`
// field. The UI keys its copy on `outcome` and never renders the helper's
// `error` string — a route error string reaching user-facing copy is the F1
// defect class. `error` is retained for logs/debugging only.
// ─────────────────────────────────────────────────────────────────────────────

// Next hands the dynamic segment ALREADY DECODED, so a request for `%25`
// arrives here as a bare `%` — and `decodeURIComponent("%")` THROWS URIError,
// which without this guard escapes as an unstructured HTTP 500 (measured: an
// empty body, no `outcome` for the UI to key on). It always failed CLOSED — no
// SQL ran, nothing was deleted — but a destructive route must return a shape
// its caller can read, so the malformed value is passed through unchanged and
// left for DATE_RE to reject as `invalid_date`.
//
// ⚠️ The GET handler above has the SAME pre-existing defect (verified: `%25`
// → 500). It is deliberately NOT fixed here — this prompt is scoped to the
// delete path and to preserving existing read behaviour. Reported, not silently
// repaired, and not silently ignored.
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

interface DeleteResult {
  ok?: boolean;
  outcome?: string;
  error?: string;
  [k: string]: unknown;
}

// outcome → HTTP. Anything unrecognised falls through to 500 rather than
// defaulting to a success-shaped response.
const OUTCOME_STATUS: Record<string, number> = {
  deleted: 200,
  not_found: 404,
  refused_multi: 409,
  refused_rowcount: 409,
  invalid_date: 400,
  vm_unreachable: 502,
  db_error: 500,
};

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date: rawDate } = await params;
  const date = safeDecode(rawDate ?? "");

  // Shape gate BEFORE anything else. The helper validates independently too, and
  // the value is a bound SQL parameter on the VM — three layers, because this is
  // the one route in the Hub that can destroy data.
  if (!DATE_RE.test(date)) {
    return NextResponse.json(
      { ok: false, outcome: "invalid_date", digest_date: date },
      { status: 400 },
    );
  }

  let res;
  try {
    // runPythonResult, not runPython: the helper exits non-zero on every refusal
    // and we need its structured outcome, not a thrown string.
    res = await runPythonResult("set_digest_delete.py", [], {
      timeout: 20_000,
      input: JSON.stringify({ digest_date: date, author: "ghost" }),
    });
  } catch (err) {
    // Genuine spawn failure (ENOENT etc) — never a silent success.
    return NextResponse.json(
      { ok: false, outcome: "db_error", digest_date: date, error: String(err) },
      { status: 500 },
    );
  }

  if (res.timedOut || res.signal) {
    return NextResponse.json(
      { ok: false, outcome: "vm_unreachable", digest_date: date },
      { status: 504 },
    );
  }

  const parsed = safeJsonParse<DeleteResult>((res.stdout || "").trim(), {});
  const outcome = typeof parsed.outcome === "string" ? parsed.outcome : "";

  // 🚨 An unparseable / outcome-less helper reply is treated as a FAILURE whose
  // true state is unknown — never as a success. The UI keeps the card and says
  // so, because a card that vanishes on an unverified delete is the single worst
  // outcome this route can produce.
  if (!outcome || !(outcome in OUTCOME_STATUS)) {
    return NextResponse.json(
      {
        ok: false,
        outcome: "db_error",
        digest_date: date,
        error: `unrecognised helper reply (exit=${res.status})`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(parsed, { status: OUTCOME_STATUS[outcome] });
}
