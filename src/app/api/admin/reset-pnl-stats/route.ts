import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { confirmText } = body;

    if (confirmText !== "RESET") {
      return NextResponse.json({ error: "Confirmation text must be exactly 'RESET'" }, { status: 400 });
    }

    console.log("[ADMIN_RESET] P&L stats reset");
    const raw = await runPython("query_admin_reset.py", ["reset_pnl_stats"]);
    return NextResponse.json(safeJsonParse(raw, { success: false }));
  } catch (err) {
    console.error(`[ADMIN_RESET] P&L reset error: ${err}`);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
