import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

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
