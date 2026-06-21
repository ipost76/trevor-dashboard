import { NextResponse } from "next/server";
import { runPython, runPythonResult, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// /api/health/ai-findings — AI Analysis Engine findings (B4 AI engine, Hub read-side)
//
// GET  → list of findings WHERE status != 'resolved' (newest first), backing the
//        Health zone findings panel + the AI Docs feed. READ-ONLY over the
//        litestream replica via query_ai_findings.py (mode=ro). recon_md is NOT
//        shipped here — each finding's `has_recon` + `recon_md_filename` let the
//        Docs feed link to /api/health/ai-findings/[id]/recon for the document.
//
// NB: auth-gated by middleware.ts (the /api/health LIVENESS allowlist is an EXACT
// match on "/api/health" only, so these data sub-routes require the session
// cookie like every other /api/* route).
//
// The recon docs live inline in the ai_findings.recon_md column — a storage
// entirely separate from the bottom-nav DOCS file system (no shared module,
// route, or storage with the downloads surface).
// ─────────────────────────────────────────────────────────────────────────────

interface AiFinding {
  id: number;
  created_at: string;
  trigger_type: string | null;
  severity: string | null;
  category: string | null;
  title: string | null;
  summary: string | null;
  root_cause: string | null;
  recommendation: string | null;
  confidence: number | null;
  evidence_json: string | null;
  status: string | null;
  model_used: string | null;
  cost_usd: number | null;
  tokens_used: number | null;
  recon_md_filename: string | null;
  has_recon: boolean;
}

interface AiFindingsResponse {
  findings: AiFinding[];
  replica_age_seconds: number | null;
  replica_mtime: string | null;
  error: string | null;
}

const FALLBACK: AiFindingsResponse = {
  findings: [],
  replica_age_seconds: null,
  replica_mtime: null,
  error: null,
};

export async function GET() {
  try {
    const raw = await runPython("query_ai_findings.py", ["list"], { timeout: 8_000 });
    const data = safeJsonParse<AiFindingsResponse>(raw, FALLBACK);
    return NextResponse.json(data);
  } catch (e) {
    // Fail-soft: never 500 the panel — return the empty shape with the error noted.
    return NextResponse.json({ ...FALLBACK, error: String(e) });
  }
}

/**
 * POST /api/health/ai-findings — "Analyze now": enqueue an AI-engine command.
 *
 * Mirrors set_killswitch.py's write surface — passes the JSON body to
 * set_ai_command.py on stdin, which INSERTs a 'pending' row into the VM LIVE
 * ai_engine_commands queue over `ssh vm` (NOT the read-only replica). Exit codes
 * map to HTTP: 0→200, 1→400 (bad command/body), 2→502 (VM/DB error). The engine
 * is capped until 2026-07-01, so the command queues until then.
 */
export async function POST(request: Request) {
  let body: { command?: unknown; params?: unknown; author?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // Empty/invalid body → default to a bare analyze_now.
    body = {};
  }

  const command = String(body.command ?? "analyze_now").trim().toLowerCase() || "analyze_now";
  const author = String(body.author ?? "ghost").trim() || "ghost";
  const params =
    body.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? (body.params as Record<string, unknown>)
      : {};
  const payload = JSON.stringify({ command, params, author });

  try {
    const res = await runPythonResult("set_ai_command.py", [], {
      input: payload,
      timeout: 15_000,
    });
    const out = safeJsonParse<{ ok?: boolean; error?: string }>(res.stdout, {
      ok: false,
      error: (res.stderr || "").slice(0, 300) || "no output",
    });
    if (res.status === 0 && out.ok) {
      return NextResponse.json(out);
    }
    // 1 = bad input (route already validates, but keep the mapping honest); else VM/DB error.
    const httpStatus = res.status === 1 ? 400 : 502;
    return NextResponse.json(
      { ok: false, error: out.error ?? `set_ai_command exit=${res.status}` },
      { status: httpStatus },
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
