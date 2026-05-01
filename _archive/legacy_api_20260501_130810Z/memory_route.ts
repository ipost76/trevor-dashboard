import { NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

// Cache ChromaDB counts separately (10s cold start due to PersistentClient init)
let _chromaCache: { patternCount: number; kbCount: number; ts: number } | null = null;
const CHROMA_CACHE_TTL = 300_000; // 5 minutes

export async function GET() {
  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const brainDir = join(trevorDir, "brain");
  const memoryDir = join(brainDir, "memory");

  try {
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

    // ChromaDB collection counts via Python helper (same as /api/brain?scope=vectors)
    let patternCount = 0;
    let kbCount = 0;
    if (_chromaCache && Date.now() - _chromaCache.ts < CHROMA_CACHE_TTL) {
      patternCount = _chromaCache.patternCount;
      kbCount = _chromaCache.kbCount;
    } else {
      try {
        const { execSync } = await import("child_process");
        const pythonPath = join(trevorDir, "venv", "bin", "python3");
        const scriptPath = join(process.cwd(), "query_brain.py");
        const raw = execSync(
          `${pythonPath} ${scriptPath} vectors`,
          { encoding: "utf-8", timeout: 15000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
        ).trim();
        const parsed = JSON.parse(raw);
        for (const col of (parsed.collections || []) as { name: string; count: number }[]) {
          if (col.name === "trade_patterns") patternCount = col.count;
          if (col.name === "knowledge_base") kbCount = col.count;
        }
        _chromaCache = { patternCount, kbCount, ts: Date.now() };
      } catch { /* Python unavailable — return cached or 0s */ }
    }

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
