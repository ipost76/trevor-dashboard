import { NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");

  try {
    const { execSync } = await import("child_process");

    const pyScript = `
import json, sys
sys.path.insert(0, "${trevorDir}")
from knowledge_base import KnowledgeBase
kb = KnowledgeBase()
print(json.dumps(kb.stats()))
`;
    const raw = execSync(
      `${pythonPath} -c '${pyScript.replace(/'/g, "'\"'\"'")}'`,
      { encoding: "utf-8", timeout: 10000, cwd: trevorDir }
    ).trim();

    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json({ total_entries: 0, error: String(err) }, { status: 500 });
  }
}
