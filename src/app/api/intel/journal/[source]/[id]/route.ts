import { NextRequest, NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  source: string;
  id: string;
}

const ALLOWED_SOURCES = new Set(["auto_trades"]);
const GEN_TIMEOUT_MS = 30_000;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<Params> }
) {
  const { source, id } = await params;
  if (!ALLOWED_SOURCES.has(source)) {
    return NextResponse.json({ error: "invalid source" }, { status: 400 });
  }
  try {
    const stdout = await runPython("query_journal_narrative.py", [source, String(id)], {
      timeout: GEN_TIMEOUT_MS,
    });
    return NextResponse.json(JSON.parse(stdout));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 200 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<Params> }
) {
  const { source, id } = await params;
  if (!ALLOWED_SOURCES.has(source)) {
    return NextResponse.json({ error: "invalid source" }, { status: 400 });
  }
  let body: { force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const args = [source, String(id)];
  if (body.force) args.push("--force");
  try {
    const stdout = await runPython("query_journal_narrative.py", args, {
      timeout: GEN_TIMEOUT_MS,
    });
    return NextResponse.json(JSON.parse(stdout));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 200 });
  }
}
