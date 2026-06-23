import { NextRequest, NextResponse } from "next/server";
import { refreshCostSnapshots } from "@/lib/cost-refresh";
import { maybeSendCostAlert } from "@/lib/cost-alert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cost/refresh — the daily-refresh WORKER for the GCP cost tracker (B4).
//
// Queries BigQuery for per-service daily net cost and UPSERTs into the
// cost_snapshots cache (data/hub.db). This is NOT the page-load path — the cost
// card reads the cache via GET /api/cost. Driven once daily by
// trevor-cost-refresh.timer; can also be hit manually for a forced refresh.
//
// AUTH: this route is allow-listed in middleware.ts (the timer's curl carries no
// session cookie), so it guards ITSELF with a bearer token — GATEWAY_TOKEN, the
// same machine-to-machine secret the write-gateway uses. Fails CLOSED if the
// token is unset. Every outcome is JSON; the worker never throws, so a refresh
// can never crash the Hub.
//   200 {status:'ok'|'no_data_yet'}   ·   401 unauthorized   ·   502 {status:'error'}
// ─────────────────────────────────────────────────────────────────────────────

function authorized(req: NextRequest): boolean {
  const expected = (process.env.GATEWAY_TOKEN || "").trim();
  if (!expected) return false; // no token configured → refuse (fail closed)
  const header = req.headers.get("authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  const provided = (m ? m[1] : "").trim();
  if (provided.length !== expected.length) return false;
  // length-equal constant-time-ish compare (no early-out on first mismatch).
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ status: "error", reason: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await refreshCostSnapshots();

    // B5: best-effort budget alert AFTER a successful cache write. maybeSendCostAlert
    // never throws (it swallows every failure), and this extra try/catch is
    // belt-and-suspenders — an alert failure can NEVER change this response or break
    // the refresh. Only runs on `ok` (fresh rows written); on no_data_yet/error the
    // forecast is unchanged or absent, so there's nothing new to alert on.
    let alert;
    if (result.status === "ok") {
      try {
        alert = await maybeSendCostAlert();
      } catch (e) {
        console.error("[cost-refresh] budget alert check failed (non-fatal):", String((e as Error)?.message || e));
      }
    }

    // ok / no_data_yet are 200 (valid states); a real failure is 502.
    return NextResponse.json(alert ? { ...result, alert } : result, {
      status: result.status === "error" ? 502 : 200,
    });
  } catch (e) {
    // Belt-and-suspenders: refreshCostSnapshots already catches everything, but
    // never 500 the Hub even on an unexpected throw.
    return NextResponse.json(
      { status: "error", reason: "unexpected", error: String((e as Error)?.message || e) },
      { status: 502 },
    );
  }
}
