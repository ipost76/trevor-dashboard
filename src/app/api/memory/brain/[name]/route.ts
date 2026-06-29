import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params { name: string; }

function validateName(name: string): string | null {
  if (!name || name.includes("/") || name.includes("..") || !name.endsWith(".md")) {
    return "invalid filename";
  }
  if (name.includes(".backup")) return "backup files not addressable";
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<Params> }) {
  const { name } = await params;
  const err = validateName(name);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  try {
    const stdout = await runPython("query_brain_read.py", [name]);
    return NextResponse.json(safeJsonParse(stdout, { error: "parse failure" }));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 200 });
  }
}

// [B3] Hub read-only lockdown (2026-06-28): the POST write surface
// (write_brain_file.py) was removed. Only the GET read remains — the path 405s on
// a write verb. validateName() is kept (the GET read uses it). Server-side kill.
