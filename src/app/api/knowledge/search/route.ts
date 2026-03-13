import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") || "";
  if (!q.trim()) {
    return NextResponse.json({ results: [], query: "" });
  }

  // Sanitize query — strip dangerous chars for shell injection prevention
  const sanitized = q.replace(/[`$;'"\\|&<>{}()!#\n\r]/g, "").trim().slice(0, 200);
  if (!sanitized) {
    return NextResponse.json({ results: [], query: q });
  }

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");

  try {
    const { execSync } = await import("child_process");

    const pyScript = `
import json, sys
sys.path.insert(0, "${trevorDir}")
from knowledge_base import KnowledgeBase
kb = KnowledgeBase()
results = kb.search("${sanitized}", n_results=10)
print(json.dumps(results if results else []))
`;
    const raw = execSync(
      `${pythonPath} -c '${pyScript.replace(/'/g, "'\"'\"'")}'`,
      { encoding: "utf-8", timeout: 15000, cwd: trevorDir }
    ).trim();

    const results = JSON.parse(raw);
    return NextResponse.json({ results, query: sanitized });
  } catch (err) {
    return NextResponse.json({ results: [], query: sanitized, error: String(err) }, { status: 500 });
  }
}
