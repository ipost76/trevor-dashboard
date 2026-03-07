import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "xp";

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const dashboardDir = process.cwd();
  const scriptPath = join(dashboardDir, "query_brain.py");

  try {
    const { execSync } = await import("child_process");
    const raw = execSync(
      `${pythonPath} ${scriptPath} ${scope}`,
      { encoding: "utf-8", timeout: 30000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
    ).trim();
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    const errMsg = String(err);
    if (scope === "xp") {
      return NextResponse.json({ currentXP: 0, currentRank: "Unknown", totalXP: 0, history: [], ranks: [], error: errMsg });
    }
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
