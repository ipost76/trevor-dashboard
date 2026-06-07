import { NextRequest, NextResponse } from "next/server";
import { gatewayWrite } from "@/lib/gateway-client";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trade_id, exit_price } = body;

    if (!trade_id || typeof trade_id !== "string") {
      return NextResponse.json(
        { error: "trade_id (string) is required" },
        { status: 400 }
      );
    }

    const price = Number(exit_price);
    if (!exit_price || isNaN(price) || price <= 0) {
      return NextResponse.json(
        { error: "Valid exit_price (positive number) is required" },
        { status: 400 }
      );
    }

    // W-C-P2a: queue-row write routes through the gateway → VM
    // (HUB_TRADE_EDIT_ENABLED, audited). Stays queue-style — the VM inserts the
    // close_requests row; the bot executes the close.
    return gatewayWrite(
      "trades.close",
      { trade_id, exit_price: price },
      { reason: "trades.close via Hub" },
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
