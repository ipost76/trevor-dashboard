import { NextResponse } from "next/server";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

const BRAIN_DIR = "/home/trevor/trevor/brain";
const MEMORY_DIR = join(BRAIN_DIR, "memory");

export async function GET() {
  try {
    const { execSync } = await import("child_process");

    let syncTimerActive = false;
    try {
      const s = execSync("systemctl is-active obsidian-sync.timer 2>/dev/null", { encoding: "utf-8", timeout: 3000 }).trim();
      syncTimerActive = s === "active";
    } catch { /* not installed */ }

    let dailyFiles: string[] = [];
    if (existsSync(MEMORY_DIR)) {
      dailyFiles = readdirSync(MEMORY_DIR).filter(f => f.endsWith(".md")).sort().reverse().slice(0, 14);
    }

    let memoryContent = "";
    const mp = join(BRAIN_DIR, "MEMORY.md");
    if (existsSync(mp)) memoryContent = readFileSync(mp, "utf8").slice(0, 2000);

    let heartbeatContent = "";
    const hp = join(BRAIN_DIR, "HEARTBEAT.md");
    if (existsSync(hp)) heartbeatContent = readFileSync(hp, "utf8").slice(0, 1000);

    return NextResponse.json({
      syncTimerActive,
      dailyFileCount: dailyFiles.length,
      dailyFiles,
      memoryContent,
      heartbeatContent,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
