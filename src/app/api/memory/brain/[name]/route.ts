import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SACRED_NAMES = new Set(["IDENTITY.md", "BRAIN.md", "SOUL.md", "AGENTS.md"]);

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

export async function POST(req: NextRequest, { params }: { params: Promise<Params> }) {
  const { name } = await params;
  const errMsg = validateName(name);
  if (errMsg) return NextResponse.json({ error: errMsg }, { status: 400 });

  // API-layer sacred guard (defense in depth — script also rejects)
  if (SACRED_NAMES.has(name)) {
    return NextResponse.json({ error: `sacred file — write rejected: ${name}` }, { status: 423 });
  }

  let body: { content?: string; author?: string };
  try { body = await req.json(); } catch { body = {}; }
  if (typeof body.content !== "string" || !body.author) {
    return NextResponse.json({ error: "content and author required" }, { status: 400 });
  }

  try {
    const stdout = await runPython("write_brain_file.py", [name, body.author], { input: body.content });
    const data = safeJsonParse<{ error?: string; ok?: boolean }>(stdout, { error: "parse failure" });
    if (data.error) return NextResponse.json(data, { status: 423 });
    return NextResponse.json(data);
  } catch (e) {
    const msg = String(e);
    // Python exits 3 for sacred/flag rejection — map to 423 Locked.
    if (msg.includes("python exit=3")) return NextResponse.json({ error: msg }, { status: 423 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
