import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const raw = await runPython("query_admin_reset.py", ["current_state"]);
    return NextResponse.json(safeJsonParse(raw, { currentCapital: 50, pnlCutoffDate: null }));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
