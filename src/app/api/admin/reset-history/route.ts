import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const raw = runPython("query_admin_reset.py", ["reset_history"]);
    return NextResponse.json(safeJsonParse(raw, { resets: [] }));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
