import { NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const scriptPath = join(process.cwd(), "query_trevor_trades.py");

  try {
    const { execSync } = await import("child_process");
    const raw = execSync(`${pythonPath} ${scriptPath}`, {
      encoding: "utf-8",
      timeout: 15000,
      cwd: trevorDir,
      env: { ...process.env, HOME: "/home/trevor" },
    }).trim();

    return NextResponse.json(JSON.parse(raw), {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), active: [], history: [], manual: [], stats: {} },
      { status: 500 }
    );
  }
}
