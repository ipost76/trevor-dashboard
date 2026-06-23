import { NextResponse } from "next/server";
import { runPythonResult, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/servant/reset — "Reset report": mark all open SERVANT findings handled.
//
// The Hub is READ-ONLY on the litestream replica, so the reset round-trips to the
// VM (the engine owns the write). Mirrors the B4 "Analyze now" write surface:
// passes an optional JSON body to set_servant_reset.py on stdin, which runs an
// ADDITIVE `UPDATE servant_findings SET handled=1 WHERE handled=0` (+ stamps
// servant_report_state) on the VM LIVE db over `ssh vm` (NOT the read-only
// replica). It NEVER deletes a row and NEVER touches servant_experiments (memory),
// so it is safe even if mis-triggered. Exit codes map to HTTP: 0→200, 2→502.
//
// Auth-gated by middleware.ts like every other /api/* route.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // Body is optional (reset has no required params); read author for provenance.
  let author = "ghost";
  try {
    const body = (await request.json()) as { author?: unknown };
    if (body && typeof body.author === "string" && body.author.trim()) {
      author = body.author.trim();
    }
  } catch {
    // empty / invalid body → bare reset
  }
  const payload = JSON.stringify({ author });

  try {
    const res = await runPythonResult("set_servant_reset.py", [], {
      input: payload,
      timeout: 15_000,
    });
    const out = safeJsonParse<{ ok?: boolean; handled?: number; error?: string }>(res.stdout, {
      ok: false,
      error: (res.stderr || "").slice(0, 300) || "no output",
    });
    if (res.status === 0 && out.ok) {
      return NextResponse.json(out);
    }
    // set_servant_reset.py only exits 0 (ok) or 2 (VM/DB error) → 502 otherwise.
    return NextResponse.json(
      { ok: false, error: out.error ?? `set_servant_reset exit=${res.status}` },
      { status: 502 },
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
