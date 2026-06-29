import { NextRequest, NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "brain";

  try {
    // Rule 26 — scope crosses to Python as an argv element via runPython(), never a shell string.
    const raw = await runPython("query_brain.py", [scope], { timeout: 30000 });
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    const errMsg = String(err);
    if (scope === "brain") {
      return NextResponse.json({ files: {}, error: errMsg });
    }
    if (scope === "vectors") {
      return NextResponse.json({ collections: [], totalDocuments: 0, error: errMsg });
    }
    if (scope === "costs") {
      return NextResponse.json({ daily: [], totalSpend: 0, byModel: [], error: errMsg });
    }
    return NextResponse.json({ error: errMsg });
  }
}

// [B3] Hub read-only lockdown (2026-06-28): the POST write surface (brain
// write_file + chroma_browse/search/add/delete) was removed. Only the GET read
// remains — the path 405s on any write verb. Server-side kill; UI removal is B1/B2.
