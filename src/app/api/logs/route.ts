import { NextRequest, NextResponse } from "next/server";
import { stat, open, readdir } from "fs/promises";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "300"), 2000);
  const search = searchParams.get("search")?.toLowerCase() || "";
  const levels = searchParams.get("levels") || ""; // comma-separated: INFO,WARNING,ERROR
  const days = Math.min(parseInt(searchParams.get("days") || "3"), 7);

  const trevorDir = process.env.TREVOR_PROJECT_DIR || join(process.env.HOME || "/root", "trevor");
  const logDir = join(trevorDir, "logs");

  const entries: Array<{
    line: string;
    timestamp: string | null;
    level: string;
    module: string | null;
    message: string;
  }> = [];
  let logPath = "";

  // Loguru format: 2026-03-04 12:34:56.789 | LEVEL    | module:func:line - message
  const loguruRe = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s*\|\s*(\w+)\s*\|\s*([^-]+?)\s*-\s*(.*)$/;

  const levelFilter = levels
    ? new Set(levels.split(",").map(l => l.trim().toUpperCase()))
    : null;

  // Collect log files for the last N days
  const logFiles: string[] = [];
  try {
    const files = await readdir(logDir);
    // Sort by name descending (most recent first)
    const sorted = files.filter(f => f.endsWith(".log")).sort().reverse();
    // Take up to `days` worth of files + the main trevor.log
    for (const f of sorted) {
      logFiles.push(join(logDir, f));
      if (logFiles.length >= days + 1) break;
    }
  } catch {
    // Fallback to single file candidates
    const candidates = [
      join(trevorDir, "logs", "trevor.log"),
      join(trevorDir, "trevor.log"),
    ];
    for (const c of candidates) {
      try {
        const s = await stat(c);
        if (s.size > 0) { logFiles.push(c); break; }
      } catch { continue; }
    }
  }

  for (const filePath of logFiles) {
    if (entries.length >= limit) break;
    try {
      const s = await stat(filePath);
      if (s.size === 0) continue;
      if (!logPath) logPath = filePath;

      const maxBytes = 512 * 1024;
      let content: string;
      if (s.size > maxBytes) {
        const fh = await open(filePath, "r");
        try {
          const buf = Buffer.alloc(maxBytes);
          await fh.read(buf, 0, maxBytes, s.size - maxBytes);
          content = buf.toString("utf-8");
        } finally {
          await fh.close();
        }
        const firstNl = content.indexOf("\n");
        if (firstNl !== -1) content = content.slice(firstNl + 1);
      } else {
        const fh = await open(filePath, "r");
        try {
          const buf = Buffer.alloc(s.size);
          await fh.read(buf, 0, s.size, 0);
          content = buf.toString("utf-8");
        } finally {
          await fh.close();
        }
      }

      const lines = content.split("\n").filter(Boolean).reverse();
      for (const line of lines) {
        if (entries.length >= limit) break;

        const match = loguruRe.exec(line);
        const timestamp = match ? match[1] : null;
        let level = "INFO";
        let module: string | null = null;
        let message = line;

        if (match) {
          level = match[2].trim().toUpperCase();
          module = match[3].trim();
          message = match[4].trim();
        } else {
          // Fallback level detection
          if (/CRITICAL/i.test(line)) level = "CRITICAL";
          else if (/ERROR/i.test(line)) level = "ERROR";
          else if (/WARN/i.test(line)) level = "WARNING";
          else if (/DEBUG/i.test(line)) level = "DEBUG";
        }

        // Apply level filter
        if (levelFilter && !levelFilter.has(level)) continue;

        // Apply search filter
        if (search && !line.toLowerCase().includes(search)) continue;

        entries.push({ line, timestamp, level, module, message });
      }
    } catch { continue; }
  }

  return NextResponse.json({ entries, logPath, total: entries.length });
}
