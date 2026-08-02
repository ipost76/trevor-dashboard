import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

// GET /api/shadow/promotions — PROMOTIONS subtab backend (RM-SHADOW-PROMOTE B2/B4).
//
// Ghost's two-sided worklist: shadows B3's nightly gate SURFACED — promote
// candidates (state='ready') + cull candidates (state='removed'). Accruing
// shadows (the auto-stamped in_progress flood) are filtered out at the source
// (query_promotion_ready.py: WHERE surfaced=1, else state IN ('ready','removed')).
//
// READ-ONLY. The Hub displays only — every state transition + the surfaced flag
// is B3's VM job. Fail-soft: an empty/missing table (or missing surfaced column
// pre-B3) returns [] (never 500), so the subtab renders its friendly empty-state.
//
// Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Promotion {
  shadow_name: string;
  description: string | null;
  state: "ready" | "in_progress" | "removed";
  n_distinct: number | null;
  expectancy_usd: number | null;
  verdict_summary: string | null;
  first_ready_at: string | null;
  updated_at: string | null;
}

interface PromotionsResponse {
  promotions: Promotion[];
  total: number;
  replica_age_seconds: number | null;
  replica_mtime: string | null;
  /**
   * 🚨 A STABLE CODE, NEVER A MESSAGE (B13). This field used to be
   * `error?: string` carrying `String(err)` — i.e. `runPython`'s
   * `python exit=N: <500 chars of stderr>` or a bare `OperationalError:
   * no such table: promotion_ready` — straight into the renderer's empty state.
   * The client now receives only a code; `plainReaderError()` owns the English.
   */
  error_code?: string;
}

/** The reader's raw text, read here and NEVER forwarded. */
interface PromotionsPayload extends PromotionsResponse {
  error_detail?: string;
}

const FALLBACK: PromotionsResponse = {
  promotions: [],
  total: 0,
  replica_age_seconds: null,
  replica_mtime: null,
};

export async function GET() {
  try {
    const raw = await runPython("query_promotion_ready.py", [], { timeout: 15_000 });
    const data = safeJsonParse<PromotionsPayload>(raw, FALLBACK);

    // 🚨 EXPLICIT RE-SHAPE, NOT PASS-THROUGH. `safeJsonParse` returns whatever
    // the reader printed, and a TS interface strips nothing at runtime — so
    // returning `data` would forward any future raw field the reader grew. Only
    // the fields named here can reach the client.
    if (data.error_code || data.error_detail) {
      // The detail belongs in the server log, and ONLY there.
      console.error(
        "[api/shadow/promotions] reader failed:",
        data.error_detail ?? "(no detail)",
      );
      return NextResponse.json(
        {
          ...FALLBACK,
          replica_age_seconds: data.replica_age_seconds ?? null,
          replica_mtime: data.replica_mtime ?? null,
          error_code: data.error_code ?? "reader_failed",
        },
        { status: 200 },
      );
    }

    return NextResponse.json({
      promotions: data.promotions ?? [],
      total: data.total ?? 0,
      replica_age_seconds: data.replica_age_seconds ?? null,
      replica_mtime: data.replica_mtime ?? null,
    });
  } catch (err) {
    // `runPython` throws `python exit=N: <500 chars of stderr>` (api-helpers.ts).
    // That message is the diagnostic — it stays here, in the log, and the client
    // gets a code. `runPython` itself is UNCHANGED: 65 consumers read it.
    console.error("[api/shadow/promotions] runPython threw:", err);
    return NextResponse.json(
      { ...FALLBACK, error_code: "reader_failed" },
      { status: 200 },
    );
  }
}
