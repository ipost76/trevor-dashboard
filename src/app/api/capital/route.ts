import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";
import { gatewayWrite } from "@/lib/gateway-client";

export async function GET() {
  try {
    const raw = await runPython("query_capital.py", ["get"]);
    return NextResponse.json(safeJsonParse(raw, { capital: 50.0 }));
  } catch {
    return NextResponse.json({ capital: 50.0 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const amount = parseFloat(body.capital);
    if (isNaN(amount) || amount < 0) {
      return NextResponse.json({ error: "Invalid capital amount" }, { status: 400 });
    }
    // W-C-P2a: write routes through the gateway → VM (no direct replica write).
    return gatewayWrite("capital.set", { amount }, { reason: "capital.set via Hub" });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
