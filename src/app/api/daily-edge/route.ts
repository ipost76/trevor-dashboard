import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { safeJsonParse } from "@/lib/api-helpers";

// DAILY EDGE route (B2) — read-and-display ONLY. Serves the daily one-tweak
// recommendation the companion engine wrote into the Hub's data/ dir. Pattern-1
// pure-TS file read (mirrors src/app/api/auth/route.ts) — NO Python bridge, NO
// trevor.db, NO write. The route never recomputes a candidate; it surfaces what
// the engine already decided.
//
// HONESTY (load-bearing): when the engine hasn't run, the file is absent →
// `{ verdict: "not_generated_yet" }` at HTTP 200 (NOT a 500, NOT a fabricated
// candidate). A malformed file → a safe error payload at 200. The candidate
// order the engine wrote (edge-first) is preserved verbatim — never re-sorted.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CANDIDATES_FILE = "daily_edge_candidates.json";
const HISTORY_FILE = "daily_edge_history.json";

// Sentinel for distinguishing a genuine parse failure from a parsed value
// (safeJsonParse returns the fallback on JSON.parse throw).
const PARSE_FAIL = { __daily_edge_parse_fail: true } as const;

type FileState = "ok" | "missing" | "malformed";

interface ReadResult<T> {
  state: FileState;
  data: T | null;
}

function readJsonFile<T>(name: string): ReadResult<T> {
  let raw: string;
  try {
    raw = readFileSync(join(process.cwd(), "data", name), "utf-8");
  } catch {
    // ENOENT (engine hasn't run yet) or any other read error → treat as missing.
    return { state: "missing", data: null };
  }
  const parsed = safeJsonParse<T | typeof PARSE_FAIL>(raw, PARSE_FAIL);
  if (parsed === PARSE_FAIL) {
    return { state: "malformed", data: null };
  }
  return { state: "ok", data: parsed as T };
}

interface CandidatesPayload {
  verdict?: string;
  today_candidate?: unknown;
  candidates?: unknown[];
  window?: unknown;
  generated_at?: string;
  freshness_note?: string;
}

export async function GET() {
  // History is non-critical — degrade silently to [] on missing/malformed.
  const historyRead = readJsonFile<unknown[]>(HISTORY_FILE);
  const history = Array.isArray(historyRead.data) ? historyRead.data : [];

  const candRead = readJsonFile<CandidatesPayload>(CANDIDATES_FILE);

  // Engine hasn't run yet — honest not-generated-yet state (200, never 500).
  if (candRead.state === "missing") {
    return NextResponse.json({
      verdict: "not_generated_yet",
      today_candidate: null,
      candidates: [],
      window: null,
      generated_at: null,
      freshness_note: null,
      history,
    });
  }

  // File exists but couldn't be parsed — safe error payload, never a crash.
  if (candRead.state === "malformed" || candRead.data === null) {
    return NextResponse.json({
      verdict: "error",
      error: `${CANDIDATES_FILE} present but could not be parsed`,
      today_candidate: null,
      candidates: [],
      window: null,
      generated_at: null,
      freshness_note: null,
      history,
    });
  }

  const c = candRead.data;
  // Preserve the engine's edge-first candidate order verbatim — never re-sort.
  const candidates = Array.isArray(c.candidates) ? c.candidates : [];

  return NextResponse.json({
    verdict: c.verdict ?? "unknown",
    today_candidate: c.today_candidate ?? null,
    candidates,
    window: c.window ?? null,
    generated_at: c.generated_at ?? null,
    freshness_note: c.freshness_note ?? null,
    history,
  });
}
