import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";
import { gatewayWrite } from "@/lib/gateway-client";

/**
 * GET /api/capital
 * Returns { capital, capital_state, error? }.
 *
 * 🚨 B2-HUB-READER-HONESTY (2026-08-04): both branches below used to mint
 * `{ capital: 50.0 }` — a number nobody read. Together with the two coercions
 * inside `query_capital.py` that made FOUR independent paths to the same
 * literal, and `trevor_config.trading_capital` has BEEN 50.0 since 2026-04-07,
 * so a total read failure was byte-identical to a successful read. The
 * coincidence is why it went unnoticed; it ends the moment capital changes.
 *
 * `capital` keeps its name and stays populated — only the unknown value moves
 * from 50.0 to null. `capital_state` is the honest discriminator.
 *
 * ⚠️ THIS ROUTE HAS NO RENDERER. Measured at this HEAD: zero components fetch
 * `/api/capital` (and the built `.next` carries only the route's own chunk).
 * The fix is deliberately producer-and-route only — inventing a capital surface
 * is beyond this prompt's scope. The point is that the NEXT consumer inherits a
 * field that can say "I don't know" instead of one that always says 50.
 */
export async function GET() {
  const UNKNOWN = { capital: null, capital_state: "unknown", error: "reader_unavailable" };
  try {
    const raw = await runPython("query_capital.py", ["get"]);
    return NextResponse.json(safeJsonParse(raw, UNKNOWN));
  } catch {
    return NextResponse.json({ ...UNKNOWN, error: "reader_failed" });
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
