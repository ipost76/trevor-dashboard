import { NextRequest, NextResponse } from "next/server";
import { gatewayWrite } from "@/lib/gateway-client";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trade_id, exit_price, new_entry, leverage } = body;
    if (!trade_id || !exit_price || !new_entry) {
      return NextResponse.json(
        { error: "trade_id, exit_price, and new_entry required" },
        { status: 400 }
      );
    }
    // W-C-P2a: queue-row write routes through the gateway → VM
    // (HUB_TRADE_EDIT_ENABLED, audited). Stays queue-style — the VM inserts the
    // hub_commands FLIP row; the bot executes it.
    return gatewayWrite(
      "trades.flip",
      {
        trade_id,
        exit_price: Number(exit_price),
        new_entry: Number(new_entry),
        leverage: Number(leverage || 1),
      },
      { reason: "trades.flip via Hub" },
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
