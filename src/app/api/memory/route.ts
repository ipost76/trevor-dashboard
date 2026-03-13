import { NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const brainDir = join(trevorDir, "brain");
  const memoryDir = join(brainDir, "memory");
  const chromaDir = join(trevorDir, "chroma_db");

  try {
    const { execSync } = await import("child_process");
    const fs = await import("fs");

    // Read HEARTBEAT.md
    let heartbeat = "";
    try {
      heartbeat = fs.readFileSync(join(brainDir, "HEARTBEAT.md"), "utf-8");
    } catch { /* file may not exist */ }

    // Read MEMORY.md (first 3000 chars)
    let memorySummary = "";
    try {
      const full = fs.readFileSync(join(brainDir, "MEMORY.md"), "utf-8");
      memorySummary = full.slice(0, 3000);
    } catch { /* file may not exist */ }

    // List daily memory files
    let dailyFiles: string[] = [];
    try {
      dailyFiles = fs.readdirSync(memoryDir)
        .filter((f: string) => f.endsWith(".md"))
        .sort()
        .reverse()
        .slice(0, 30);
    } catch { /* dir may not exist */ }

    // Brain file stats
    const brainFiles = ["IDENTITY.md", "BRAIN.md", "SOUL.md", "AGENTS.md", "MEMORY.md", "HEARTBEAT.md"];
    const brainStats: Record<string, { exists: boolean; modified: string; size: number }> = {};
    for (const f of brainFiles) {
      try {
        const stat = fs.statSync(join(brainDir, f));
        brainStats[f] = { exists: true, modified: stat.mtime.toISOString(), size: stat.size };
      } catch {
        brainStats[f] = { exists: false, modified: "", size: 0 };
      }
    }

    // ChromaDB collection counts via Python
    let patternCount = 0;
    let kbCount = 0;
    try {
      const pyScript = `
import json, sys
try:
    import chromadb
    c = chromadb.PersistentClient(path="${chromaDir}")
    cols = c.list_collections()
    result = {}
    for col in cols:
        result[col.name] = col.count()
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;
      const pyResult = execSync(
        `${join(trevorDir, "venv", "bin", "python3")} -c '${pyScript.replace(/'/g, "'\"'\"'")}'`,
        { encoding: "utf-8", timeout: 10000, cwd: trevorDir }
      ).trim();
      const counts = JSON.parse(pyResult);
      patternCount = counts["trade_patterns"] || counts["trade-patterns"] || 0;
      kbCount = counts["knowledge_base"] || counts["knowledge-base"] || 0;
    } catch { /* chromadb query failed */ }

    return NextResponse.json({
      heartbeat,
      memorySummary,
      dailyFiles,
      brainStats,
      patternCount,
      kbCount,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
