import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

/**
 * gateway-client — the Hub ROUTE side of the two-hop write path  [W-C-P2a]
 * ----------------------------------------------------------------------------
 * Every dangerous trevor.db writer (financial / destructive / state-changing)
 * routes its WRITE through here instead of opening the read-only replica. We
 * POST an op envelope to the LOCAL gateway (127.0.0.1:3939), which validates +
 * forwards over Tailscale to the VM gateway. The VM owns helper dispatch, the
 * authoritative auto_config flag check, and the mandatory change_log audit.
 *
 * Reads are unaffected — they keep hitting the local 0444 replica directly.
 *
 * Fail modes are normalised so no route returns a raw readonly-DB 500 anymore:
 *   200 → success (we unwrap the helper payload)        · 423 → gate locked
 *   400 → validation / unknown_op                        · 401 → auth (internal)
 *   502 → VM/gateway unreachable                         · 504 → VM/gateway timeout
 * Until the VM gateway is deployed, valid writes fail CLOSED at 502/504.
 */

const GATEWAY_BASE =
  process.env.GATEWAY_INTERNAL_URL || `http://127.0.0.1:${process.env.GATEWAY_PORT || "3939"}`;
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || "";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface GatewayResult {
  status: number;
  body: Record<string, unknown>;
}

export interface GatewayCallOpts {
  actor?: string;
  reason?: string;
  sourceType?: string;
  timeoutMs?: number;
}

/**
 * Forward a write op to the local gateway. ALWAYS resolves (never throws): a
 * transport failure becomes a 502/504 result so route handlers stay simple.
 */
export async function callGateway(
  op: string,
  args: Record<string, unknown>,
  opts: GatewayCallOpts = {},
): Promise<GatewayResult> {
  if (!GATEWAY_TOKEN) {
    return { status: 500, body: { ok: false, error: "gateway_token_missing" } };
  }

  const envelope = {
    op,
    args,
    actor: opts.actor ?? "hub:ui",
    source_type: opts.sourceType ?? "UI",
    reason: opts.reason ?? "",
    idempotency_key: randomUUID(),
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${GATEWAY_BASE}/gateway/write`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify(envelope),
      cache: "no-store",
      signal: ac.signal,
    });
    let body: Record<string, unknown>;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    return { status: res.status, body };
  } catch (e) {
    const aborted = (e as { name?: string })?.name === "AbortError";
    return {
      status: aborted ? 504 : 502,
      body: {
        ok: false,
        error: aborted ? "gateway_timeout" : "gateway_unreachable",
        layer: "hub",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Translate a GatewayResult into a NextResponse. On 200 we unwrap the helper's
 * `result` payload so existing client contracts are byte-compatible with the
 * pre-gateway responses; on any non-200 we pass the gateway body + status
 * through faithfully (423/502/504 reach the client as-is).
 */
export function gatewayResponse(result: GatewayResult): NextResponse {
  const { status, body } = result;
  if (status === 200) {
    const payload =
      body && typeof body === "object" && "result" in body
        ? (body as { result?: unknown }).result
        : body;
    return NextResponse.json((payload ?? { ok: true }) as Record<string, unknown>, { status: 200 });
  }
  return NextResponse.json(body, { status });
}

/**
 * Convenience for the common route shape: call + translate in one step.
 * Routes that need the success payload for follow-up work (e.g. the edit-entry
 * Discord card) should call `callGateway` directly and branch on `status`.
 */
export async function gatewayWrite(
  op: string,
  args: Record<string, unknown>,
  opts: GatewayCallOpts = {},
): Promise<NextResponse> {
  return gatewayResponse(await callGateway(op, args, opts));
}
