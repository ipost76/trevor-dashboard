import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from "fs";

export const dynamic = "force-dynamic";

const KILL_SWITCH_PATH = "/home/trevor/trevor/.kill_switch";

export async function GET() {
  try {
    if (existsSync(KILL_SWITCH_PATH)) {
      const stat = statSync(KILL_SWITCH_PATH);
      const reason = readFileSync(KILL_SWITCH_PATH, "utf-8").trim() || "Manual activation";
      return NextResponse.json({
        active: true,
        activated_at: stat.mtime.toISOString(),
        reason,
      });
    }
    return NextResponse.json({ active: false });
  } catch (e) {
    return NextResponse.json({ active: false, error: String(e) });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, reason } = body;

    if (action === "activate") {
      writeFileSync(
        KILL_SWITCH_PATH,
        reason || `Activated via Hub at ${new Date().toISOString()}`
      );
      return NextResponse.json({ active: true, message: "Kill switch ACTIVATED" });
    } else if (action === "deactivate") {
      if (existsSync(KILL_SWITCH_PATH)) {
        unlinkSync(KILL_SWITCH_PATH);
      }
      return NextResponse.json({ active: false, message: "Kill switch DEACTIVATED" });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "activate" or "deactivate".' },
      { status: 400 }
    );
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
