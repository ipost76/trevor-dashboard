import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

let _cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL = 15_000; // 15s

export async function GET() {
  try {
    const now = Date.now();
    if (_cache && now - _cache.ts < CACHE_TTL) {
      return NextResponse.json(_cache.data);
    }

    const raw = await runPython("query_circuit_breaker.py", [], { timeout: 10_000 });
    const data = JSON.parse(raw);
    _cache = { data, ts: now };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { overall_status: "UNKNOWN", error: String(e) },
      { status: 500 }
    );
  }
}
