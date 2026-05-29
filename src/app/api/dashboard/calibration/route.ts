import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY = {
  buckets: [],
  sweet_spot: null,
  dead_zone: null,
  data_available: false,
  message: "Calibration query failed.",
};

export async function GET() {
  try {
    const stdout = await runPython("query_dashboard_calibration.py", [], { timeout: 8000 });
    return NextResponse.json(safeJsonParse(stdout, EMPTY));
  } catch (err) {
    return NextResponse.json({ ...EMPTY, message: String(err) }, { status: 200 });
  }
}
