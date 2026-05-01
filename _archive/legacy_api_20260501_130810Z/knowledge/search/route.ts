import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SIDECAR_URL = "http://127.0.0.1:5100";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") || "";
  if (!q.trim()) {
    return NextResponse.json({ results: [], query: "" });
  }

  const sanitized = q.replace(/[`$;'"\\|&<>{}()!#\n\r]/g, "").trim().slice(0, 200);
  if (!sanitized) {
    return NextResponse.json({ results: [], query: q });
  }

  try {
    const sidecarRes = await fetch(`${SIDECAR_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collection: "knowledge_base",
        query: sanitized,
        n_results: 10,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!sidecarRes.ok) {
      const err = await sidecarRes.text();
      return NextResponse.json(
        { results: [], query: sanitized, error: `Sidecar error: ${sidecarRes.status} ${err}` },
        { status: 502 }
      );
    }

    const data = await sidecarRes.json();
    return NextResponse.json({ results: data.results || [], query: sanitized });
  } catch (err) {
    return NextResponse.json(
      { results: [], query: sanitized, error: `Embedding sidecar unavailable: ${String(err)}` },
      { status: 503 }
    );
  }
}
