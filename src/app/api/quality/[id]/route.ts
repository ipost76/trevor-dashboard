import { NextResponse } from "next/server";
import { gatewayWrite } from "@/lib/gateway-client";

// /api/quality/[id] — approve or reject a quality pattern
//
// POST  body: { action: "approve" | "reject" }
//
// Auth: middleware enforces session cookie.

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const pid = parseInt(id, 10);
    if (isNaN(pid)) {
      return NextResponse.json(
        { ok: false, error: "invalid pattern id" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const action = String(body.action || "").toLowerCase();
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { ok: false, error: `unknown action: ${action}` },
        { status: 400 }
      );
    }

    // W-C-P2a: routed through the gateway → VM (HUB_LIST_WRITE_ENABLED, audited).
    return gatewayWrite("quality.set", { action, pid }, { reason: `quality.${action} via Hub` });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e) },
      { status: 500 }
    );
  }
}
