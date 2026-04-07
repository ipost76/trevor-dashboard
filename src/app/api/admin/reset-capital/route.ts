import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { newCapital, confirmText } = body;

    if (confirmText !== "RESET") {
      return NextResponse.json({ error: "Confirmation text must be exactly 'RESET'" }, { status: 400 });
    }
    const amount = parseFloat(newCapital);
    if (!Number.isFinite(amount) || amount <= 0 || amount >= 100000000) {
      return NextResponse.json({ error: "Capital must be > 0 and < 100,000,000" }, { status: 400 });
    }

    console.log(`[ADMIN_RESET] Capital reset: ${amount}`);
    const raw = runPython("query_admin_reset.py", ["reset_capital", String(amount)]);
    return NextResponse.json(safeJsonParse(raw, { success: false }));
  } catch (err) {
    console.error(`[ADMIN_RESET] Capital reset error: ${err}`);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
