import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stdout = await runPython("query_shadow_status.py", []);
    return NextResponse.json(JSON.parse(stdout));
  } catch (err) {
    // 🚨 B13 — byte-for-byte UO-2's shape, and WIDER REACH: this backs the Intel
    // zone's LANDING tab, not a subtab. `String(err)` put `runPython`'s
    // `python exit=N: <500 chars of stderr>` into `<EmptyState body>`. The raw
    // text stays in the server log; the client gets a code the renderer glosses.
    // `runPython` is UNCHANGED — its message IS this log line.
    console.error("[api/intel/shadow] runPython/parse failed:", err);
    return NextResponse.json(
      { shadow: {}, error_code: "reader_failed" },
      { status: 200 },
    );
  }
}
