import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DailyResult {
  status?: string;
  date?: string;
  content?: string;
  size_bytes?: number;
  modified_at?: string;
  error?: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params;

  // Validate date format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
  }

  // Daily memory is a flat brain/memory/<date>.md file that lives ONLY on the VM
  // (no SQLite table — NOT in the litestream replica). Read it over the read-only
  // `ssh vm` pipe via query_memory_daily.py, matching the RM-MEM-A3 sibling memory
  // routes (query_memory_entries.py / query_brain_read.py). Pre-migration this route
  // did a local fs.readFileSync of a path that no longer exists on the WSL box.
  try {
    const stdout = await runPython("query_memory_daily.py", [date]);
    const data = safeJsonParse<DailyResult>(stdout, {
      status: "error",
      date,
      error: "parse failure",
    });

    if (data.status === "ok") {
      return NextResponse.json({ date, content: data.content ?? "" });
    }
    if (data.status === "not_found") {
      // No memory file for this date — graceful 404, not a 500.
      return NextResponse.json({ error: data.error ?? "File not found", date }, { status: 404 });
    }
    // VM unreachable / read error / parse failure — surface the real cause honestly
    // (200 so safeFetch passes the body through, never masking an outage as no-data).
    return NextResponse.json({ error: data.error ?? "memory read failed", date }, { status: 200 });
  } catch (e) {
    // runPython threw (e.g. non-zero exit) — never a 500.
    return NextResponse.json({ error: String(e), date }, { status: 200 });
  }
}
