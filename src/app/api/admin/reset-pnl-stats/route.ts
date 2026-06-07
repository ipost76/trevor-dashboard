import { NextResponse } from "next/server";
import { gatewayWrite } from "@/lib/gateway-client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { confirmText } = body;

    if (confirmText !== "RESET") {
      return NextResponse.json({ error: "Confirmation text must be exactly 'RESET'" }, { status: 400 });
    }

    console.log("[ADMIN_RESET] P&L stats reset");
    // W-C-P2a: routed through the gateway → VM (HUB_CAPITAL_WRITE_ENABLED, audited).
    return gatewayWrite("pnl_stats.reset", { confirmText }, { reason: "pnl_stats.reset via Hub" });
  } catch (err) {
    console.error(`[ADMIN_RESET] P&L reset error: ${err}`);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
