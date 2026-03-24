import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "";
  const category = searchParams.get("category") || "";
  const priority = searchParams.get("priority") || "";

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const scriptPath = join(process.cwd(), "query_dev_tasks.py");

  try {
    const { execSync } = await import("child_process");
    const raw = execSync(
      `${pythonPath} ${scriptPath} list "${status}" "${category}" "${priority}"`,
      { encoding: "utf-8", timeout: 10000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
    ).trim();
    return NextResponse.json(JSON.parse(raw));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ tasks: [], counts: { total: 0, open: 0, wip: 0, done: 0 }, error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, status: newStatus } = body;
  if (!id || !newStatus) {
    return NextResponse.json({ error: "id and status required" }, { status: 400 });
  }

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const scriptPath = join(process.cwd(), "query_dev_tasks.py");

  try {
    const { execSync } = await import("child_process");
    const raw = execSync(
      `${pythonPath} ${scriptPath} toggle ${id} ${newStatus}`,
      { encoding: "utf-8", timeout: 10000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
    ).trim();
    return NextResponse.json(JSON.parse(raw));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
