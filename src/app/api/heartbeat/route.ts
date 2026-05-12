import { NextResponse } from "next/server";

// HB-04: thin proxy to the Observatory aiohttp server on 127.0.0.1:3335.
// Keeps the Hub's "all data flows through /api/*" convention while the actual
// collector + classifier + cache live in trevor-observatory.service.
const OBSERVATORY_URL = "http://127.0.0.1:3335/api/heartbeat";
const OBSERVATORY_REFRESH_URL = "http://127.0.0.1:3335/api/heartbeat/refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(OBSERVATORY_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Observatory returned ${res.status}` },
        { status: 502 },
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Observatory unreachable", details: String(error) },
      { status: 503 },
    );
  }
}

export async function POST() {
  try {
    const res = await fetch(OBSERVATORY_REFRESH_URL, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Observatory refresh returned ${res.status}` },
        { status: 502 },
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Observatory unreachable", details: String(error) },
      { status: 503 },
    );
  }
}
