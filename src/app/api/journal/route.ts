import { NextRequest, NextResponse } from "next/server";
import { runPythonInline } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// Async inline-python wrapper — code via stdin (no shell), never blocks the loop.
function runInlinePython(
  code: string,
  extraEnv?: Record<string, string>,
  timeout = 10000
): Promise<string> {
  return runPythonInline(code, { timeout, env: extraEnv });
}

export async function GET() {
  const script = `
import sqlite3, json, os

db = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")
conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row

# Auto-generate daily journal from closed trades
rows = conn.execute("""
    SELECT date(closed_at) as trade_date,
           COUNT(*) as trades,
           SUM(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END) as wins,
           SUM(CASE WHEN pnl_pct <= 0 THEN 1 ELSE 0 END) as losses,
           ROUND(SUM(pnl_pct), 2) as total_pnl,
           ROUND(AVG(pnl_pct), 2) as avg_pnl,
           MAX(pnl_pct) as best_pnl,
           MIN(pnl_pct) as worst_pnl
    FROM active_trades
    WHERE status = 'closed' AND closed_at IS NOT NULL
    GROUP BY date(closed_at)
    ORDER BY date(closed_at) DESC
    LIMIT 90
""").fetchall()

entries = []
for r in rows:
    d = dict(r)
    # Get individual trades for this day
    day_trades = conn.execute("""
        SELECT ticker, direction, pnl_pct, leverage, confidence
        FROM active_trades
        WHERE status='closed' AND date(closed_at) = ?
        ORDER BY pnl_pct DESC
    """, (d["trade_date"],)).fetchall()

    best = day_trades[0] if day_trades else None
    worst = day_trades[-1] if day_trades else None
    trade_list = [f"{t['ticker']} {t['direction']} {(t['pnl_pct'] or 0):+.1f}%" for t in day_trades]

    # Exit condition distribution
    exit_rows = conn.execute("""
        SELECT COALESCE(last_exit_condition, 'manual') as er, COUNT(*) as cnt
        FROM active_trades
        WHERE status='closed' AND date(closed_at) = ?
        GROUP BY er
    """, (d["trade_date"],)).fetchall()
    exit_parts = [f"{r['cnt']} {r['er'].lower()}" for r in exit_rows if r['er']]

    # Avg hold duration
    hold_row = conn.execute("""
        SELECT ROUND(AVG((julianday(closed_at) - julianday(created_at)) * 24), 1) as avg_h
        FROM active_trades WHERE status='closed' AND date(closed_at) = ?
    """, (d["trade_date"],)).fetchone()
    avg_hold = hold_row['avg_h'] if hold_row and hold_row['avg_h'] else None

    wr = round(d["wins"] / d["trades"] * 100) if d["trades"] else 0
    content = f"**Trades closed:** {d['trades']} ({d['wins']}W / {d['losses']}L)\\n"
    content += f"**Day P&L:** {d['total_pnl']:+.1f}% | Win Rate: {wr}%\\n"
    if best:
        content += f"**Best:** {best['ticker']} {best['direction']} {(best['pnl_pct'] or 0):+.1f}% ({best['leverage']}x)\\n"
    if worst and worst != best:
        content += f"**Worst:** {worst['ticker']} {worst['direction']} {(worst['pnl_pct'] or 0):+.1f}% ({worst['leverage']}x)\\n"
    if exit_parts:
        content += f"**Exits:** {', '.join(exit_parts)}\\n"
    if avg_hold is not None:
        content += f"**Avg Hold:** {avg_hold}h\\n"
    content += f"**All:** {', '.join(trade_list)}"

    entries.append({
        "date": d["trade_date"],
        "filename": f"{d['trade_date']}.md",
        "content": content,
        "trades": d["trades"],
        "wins": d["wins"],
        "losses": d["losses"],
        "total_pnl": d["total_pnl"],
        "size": len(content),
    })

conn.close()
print(json.dumps({"entries": entries}))
`.trim();

  try {
    const raw = await runInlinePython(script);
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json(
      { entries: [], error: String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const title = body.title;
    const content = body.content;

    if (!title || !content) {
      return NextResponse.json(
        { error: "title and content required" },
        { status: 400 }
      );
    }

    // Sanitize title for filename safety; content passed via env var
    const safeTitle = title.replace(/[^\w\s\-.,!?:]/g, "").slice(0, 200);
    const safeContent = content.slice(0, 50000);

    const script = `
import os, json
from datetime import datetime

trevor_dir = os.environ.get("TREVOR_PROJECT_DIR", "/home/trevor/trevor")
journal_dir = os.path.join(trevor_dir, "brain", "journal")
os.makedirs(journal_dir, exist_ok=True)

title = os.environ.get("JOURNAL_TITLE", "Untitled")
content = os.environ.get("JOURNAL_CONTENT", "")

filename = datetime.utcnow().strftime("%Y-%m-%d-%H%M%S") + ".md"
path = os.path.join(journal_dir, filename)

body = f"# {title}\\n\\n{content}\\n"
with open(path, "w", encoding="utf-8") as f:
    f.write(body)

print(json.dumps({"ok": True, "filename": filename}))
`.trim();

    const raw = await runInlinePython(script, {
      JOURNAL_TITLE: safeTitle,
      JOURNAL_CONTENT: safeContent,
    });

    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const filename = body.filename;

    if (!filename) {
      return NextResponse.json(
        { error: "filename required" },
        { status: 400 }
      );
    }

    // Validate filename: must end with .md, no path traversal
    if (
      !filename.endsWith(".md") ||
      filename.includes("/") ||
      filename.includes("\\") ||
      filename.includes("..")
    ) {
      return NextResponse.json(
        { error: "Invalid filename" },
        { status: 400 }
      );
    }

    // Strip any remaining unsafe chars
    const safeFilename = filename.replace(/[^\w\-. ]/g, "");

    const script = `
import os, json

trevor_dir = os.environ.get("TREVOR_PROJECT_DIR", "/home/trevor/trevor")
journal_dir = os.path.join(trevor_dir, "brain", "journal")
filename = os.environ.get("JOURNAL_FILENAME", "")
path = os.path.join(journal_dir, filename)

if not os.path.isfile(path):
    print(json.dumps({"error": "File not found"}))
else:
    os.remove(path)
    print(json.dumps({"ok": True, "deleted": filename}))
`.trim();

    const raw = await runInlinePython(script, {
      JOURNAL_FILENAME: safeFilename,
    });

    const result = JSON.parse(raw);
    if (result.error) {
      return NextResponse.json(result, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
