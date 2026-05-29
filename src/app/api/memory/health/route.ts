import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

// /api/memory/health — Read-only system health snapshot.
// Calls query_system_health.py (self-probe collector). Always returns HTTP 200;
// degraded shape on error so the UI handles failure gracefully.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stdout = await runPython("query_system_health.py", []);
    return NextResponse.json(JSON.parse(stdout));
  } catch (e) {
    return NextResponse.json(
      {
        snapshot_at: new Date().toISOString(),
        killswitch_enabled: false,
        services: [],
        collectors: [],
        sentinels: [],
        source: "self-probe",
        stale_seconds: null,
        error: String(e),
      },
      { status: 200 },
    );
  }
}
