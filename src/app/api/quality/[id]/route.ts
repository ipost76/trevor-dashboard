import { NextResponse } from "next/server";
import { execSync } from "child_process";

// /api/quality/[id] — approve or reject a quality pattern
//
// POST  body: { action: "approve" | "reject" }
//
// Auth: middleware enforces session cookie.

export const dynamic = "force-dynamic";

const PY = "/home/trevor/trevor/venv/bin/python";
const HELPER = "/home/trevor/trevor-dashboard/query_quality.py";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const pid = parseInt(id, 10);
    if (isNaN(pid)) {
      return NextResponse.json(
        { ok: false, error: "invalid pattern id" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const action = String(body.action || "").toLowerCase();
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { ok: false, error: `unknown action: ${action}` },
        { status: 400 }
      );
    }

    const cmd = `${PY} ${HELPER} ${action} ${pid}`;
    const raw = execSync(cmd, { timeout: 10_000, encoding: "utf-8" });
    const result = JSON.parse(raw);

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e) },
      { status: 500 }
    );
  }
}
