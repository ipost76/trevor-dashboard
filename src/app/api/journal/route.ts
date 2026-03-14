import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { TREVOR_DIR } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const PYTHON_PATH = join(TREVOR_DIR, "venv", "bin", "python3");

function runInlinePython(
  code: string,
  extraEnv?: Record<string, string>,
  timeout = 10000
): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execSync } = require("child_process");
  // Pass code via stdin to avoid shell quoting issues
  return execSync(`${PYTHON_PATH} -`, {
    encoding: "utf-8",
    input: code,
    timeout,
    cwd: TREVOR_DIR,
    env: { ...process.env, HOME: "/home/trevor", ...extraEnv },
  }).trim();
}

export async function GET() {
  const script = `
import os, json

trevor_dir = os.environ.get("TREVOR_PROJECT_DIR", "/home/trevor/trevor")
journal_dir = os.path.join(trevor_dir, "brain", "journal")
os.makedirs(journal_dir, exist_ok=True)

entries = []
for f in sorted(os.listdir(journal_dir), reverse=True):
    if f.endswith('.md'):
        path = os.path.join(journal_dir, f)
        with open(path, encoding='utf-8') as fh:
            content = fh.read()
        entries.append({
            "filename": f,
            "content": content,
            "date": f.replace(".md", ""),
            "size": len(content),
        })

print(json.dumps({"entries": entries}))
`.trim();

  try {
    const raw = runInlinePython(script);
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

    const raw = runInlinePython(script, {
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

    const raw = runInlinePython(script, {
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
