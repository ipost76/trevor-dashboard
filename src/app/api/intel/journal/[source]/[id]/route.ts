import { NextRequest, NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";
import { gatewayWrite } from "@/lib/gateway-client";

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
    // W-C-P2b: GET is cache-read-only — returns an existing trade_journal row
    // and NEVER generates (generation writes + burns Anthropic budget, now
    // POST-only via the gateway). Pure read; the helper opens the DB read-only.
    const stdout = await runPython("query_journal_narrative.py", [source, String(id), "--cache-only"], {
      timeout: 10_000,
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
  // W-C-P2b: generation routes through the gateway → VM (HUB_BENIGN_WRITE_ENABLED,
  // audited). The Haiku call + trade_journal INSERT + budget increment all run
  // VM-side against the live DB — never the read-only replica. timeoutMs covers
  // the VM-side Haiku call. Fail-closed: VM down → 502 (no replica write).
  return gatewayWrite(
    "journal.generate",
    { source, id: Number(id), force: Boolean(body.force) },
    { reason: "journal.generate via Hub", timeoutMs: GEN_TIMEOUT_MS },
  );
}
