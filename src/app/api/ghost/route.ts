import { NextResponse } from "next/server";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

const BRAIN_DIR = "/home/trevor/trevor/brain";
const MEMORY_DIR = join(BRAIN_DIR, "memory");

function extractField(text: string, pattern: RegExp): string {
  const m = text.match(pattern);
  return m ? m[1].trim() : "";
}

function extractNumber(text: string, pattern: RegExp): number {
  const m = text.match(pattern);
  return m ? parseInt(m[1]) || 0 : 0;
}

function parseHeartbeat(raw: string) {
  if (!raw) return null;
  const last_active = extractField(raw, /Last active:\s*(.+)/);
  const signals_today = extractNumber(raw, /Signals today:\s*(\d+)/);
  const trades_closed = extractNumber(raw, /Trades closed today:\s*(\d+)/);
  const api_budget = extractField(raw, /API budget spent:\s*(.+)/);

  // Determine alive status from last_active time
  let alive_status: "alive" | "warn" | "dead" = "dead";
  if (last_active) {
    try {
      // Parse "03/30 08:55 AM ET" format
      const now = new Date();
      const year = now.getFullYear();
      const match = last_active.match(/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*ET/i);
      if (match) {
        let hours = parseInt(match[3]);
        if (match[5].toUpperCase() === "PM" && hours !== 12) hours += 12;
        if (match[5].toUpperCase() === "AM" && hours === 12) hours = 0;
        // Create date in ET (approximate — use UTC offset of -4 or -5)
        const etDate = new Date(`${year}-${match[1]}-${match[2]}T${String(hours).padStart(2, "0")}:${match[4]}:00-04:00`);
        const diffMin = (now.getTime() - etDate.getTime()) / 60000;
        if (diffMin < 60) alive_status = "alive";
        else if (diffMin < 360) alive_status = "warn";
      }
    } catch { /* default to dead */ }
  }

  return { last_active, signals_today, trades_closed, api_budget, alive_status, raw };
}

function parseMemorySections(raw: string): Array<{ title: string; content: string }> {
  if (!raw) return [];
  // Split on ## headings, skip the preamble before first ##
  const parts = raw.split(/^## /m);
  const sections: Array<{ title: string; content: string }> = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    const lines = part.split("\n");
    const title = lines[0].trim();
    if (!title) continue;
    // Skip the main title/header block (lines starting with # or >)
    if (title.startsWith("#") || title.startsWith(">")) continue;
    const content = lines.slice(1).join("\n").trim();
    sections.push({ title, content });
  }
  return sections;
}

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
      dailyFiles = readdirSync(MEMORY_DIR).filter(f => f.endsWith(".md")).sort().reverse().slice(0, 18);
    }

    let memoryContent = "";
    const mp = join(BRAIN_DIR, "MEMORY.md");
    if (existsSync(mp)) memoryContent = readFileSync(mp, "utf8").slice(0, 2000);

    let heartbeatContent = "";
    const hp = join(BRAIN_DIR, "HEARTBEAT.md");
    if (existsSync(hp)) heartbeatContent = readFileSync(hp, "utf8").slice(0, 1000);

    const heartbeat = parseHeartbeat(heartbeatContent);
    const memorySections = parseMemorySections(memoryContent);

    return NextResponse.json({
      syncTimerActive,
      dailyFileCount: dailyFiles.length,
      dailyFiles,
      heartbeat,
      memorySections,
      memoryContent,
      heartbeatContent,
    }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
