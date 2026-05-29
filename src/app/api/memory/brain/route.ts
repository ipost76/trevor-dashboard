import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stdout = await runPython("query_brain_files.py", []);
    return NextResponse.json(safeJsonParse(stdout, { files: [], edit_enabled: false, sacred_count: 0, non_sacred_count: 0 }));
  } catch (err) {
    return NextResponse.json({ files: [], edit_enabled: false, sacred_count: 0, non_sacred_count: 0, error: String(err) }, { status: 200 });
  }
}
