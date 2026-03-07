import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "health";

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const dashboardDir = process.cwd();
  const scriptPath = join(dashboardDir, "chat_bridge.py");

  try {
    const { execSync } = await import("child_process");

    if (action === "health") {
      const raw = execSync(
        `${pythonPath} ${scriptPath} health`,
        { encoding: "utf-8", timeout: 10000, cwd: trevorDir,
          env: { ...process.env, HOME: "/home/trevor", DASHBOARD_DIR: dashboardDir } }
      ).trim();
      return NextResponse.json(JSON.parse(raw));
    }

    if (action === "history") {
      const sessionId = searchParams.get("sessionId") || "default";
      const limit = searchParams.get("limit") || "50";
      const raw = execSync(
        `${pythonPath} ${scriptPath} history "${sessionId}" ${limit}`,
        { encoding: "utf-8", timeout: 10000, cwd: trevorDir,
          env: { ...process.env, HOME: "/home/trevor", DASHBOARD_DIR: dashboardDir } }
      ).trim();
      return NextResponse.json(JSON.parse(raw));
    }

    if (action === "sessions") {
      const raw = execSync(
        `${pythonPath} ${scriptPath} sessions`,
        { encoding: "utf-8", timeout: 10000, cwd: trevorDir,
          env: { ...process.env, HOME: "/home/trevor", DASHBOARD_DIR: dashboardDir } }
      ).trim();
      return NextResponse.json(JSON.parse(raw));
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err), online: false });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const message = body.message || "";
  const sessionId = body.sessionId || "default";

  if (!message.trim()) {
    return NextResponse.json({ error: "Message required" }, { status: 400 });
  }

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const dashboardDir = process.cwd();
  const scriptPath = join(dashboardDir, "chat_bridge.py");

  try {
    const { execSync } = await import("child_process");
    // Pass message via env var to avoid shell injection
    const safeMessage = message.replace(/"/g, '\\"').replace(/\$/g, '\$').replace(/`/g, '\`');
    const raw = execSync(
      `${pythonPath} ${scriptPath} chat "${safeMessage}" "${sessionId}"`,
      { encoding: "utf-8", timeout: 90000, cwd: trevorDir,
        env: { ...process.env, HOME: "/home/trevor", DASHBOARD_DIR: dashboardDir } }
    ).trim();
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json({ error: String(err), ok: false }, { status: 500 });
  }
}
