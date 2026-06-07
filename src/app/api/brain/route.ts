import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "brain";

  try {
    // Rule 26 — scope crosses to Python as an argv element via runPython(), never a shell string.
    const raw = await runPython("query_brain.py", [scope], { timeout: 30000 });
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    const errMsg = String(err);
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

// Sacred brain files are INVIOLABLE. Normalize (strip .md, any case) so that
// IDENTITY.md / identity / SOUL.MD all hit the guard — the pre-W-C-P2a check
// compared the .md-suffixed request name against suffix-less entries (e.g.
// "IDENTITY.md".toUpperCase() = "IDENTITY.MD") and MISSED, leaking sacred writes.
const SACRED_FILES = new Set(["IDENTITY", "BRAIN", "SOUL", "AGENTS"]);
function isSacredBrainName(name: string): boolean {
  const base = name.trim().replace(/\.md$/i, "").toUpperCase();
  return SACRED_FILES.has(base);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action } = body;

  if (!action) {
    return NextResponse.json({ error: "Action required" }, { status: 400 });
  }

  try {
    if (action === "write_file") {
      const { name, content } = body;
      if (!name || content === undefined) {
        return NextResponse.json({ error: "name and content required" }, { status: 400 });
      }
      // Sacred files are inviolable — hard 423, NO override (the old
      // confirm_sacred escape hatch is removed). Matches the robust
      // /api/memory/brain/[name] guard.
      if (isSacredBrainName(name)) {
        return NextResponse.json(
          { error: `sacred brain file — write rejected: ${name}` },
          { status: 423 }
        );
      }
      // HUB_BRAIN_EDIT_ENABLED (an auto_config row, default OFF) is enforced in
      // manage_brain.py as defense in depth — it exits 3 when locked, which the
      // catch below maps to 423 Locked.
      const raw = await runPython("manage_brain.py", ["write_file", name, content], { timeout: 15000 });
      return NextResponse.json(safeJsonParse(raw, { error: "Failed to parse response" }));
    }

    if (action === "chroma_browse") {
      const { collection, limit = 20, offset = 0 } = body;
      if (!collection) {
        return NextResponse.json({ error: "collection required" }, { status: 400 });
      }
      const raw = await runPython(
        "manage_brain.py",
        ["chroma_browse", collection, String(limit), String(offset)],
        { timeout: 30000 }
      );
      return NextResponse.json(safeJsonParse(raw, { entries: [], total: 0, error: "Failed to parse response" }));
    }

    if (action === "chroma_search") {
      const { collection, query, limit = 5 } = body;
      if (!collection) {
        return NextResponse.json({ error: "collection required" }, { status: 400 });
      }
      if (!query) {
        return NextResponse.json({ error: "query required" }, { status: 400 });
      }
      const raw = await runPython(
        "manage_brain.py",
        ["chroma_search", collection, query, String(limit)],
        { timeout: 30000 }
      );
      return NextResponse.json(safeJsonParse(raw, { results: [], error: "Failed to parse response" }));
    }

    if (action === "chroma_add") {
      const { collection, document, metadata = {} } = body;
      if (!collection) {
        return NextResponse.json({ error: "collection required" }, { status: 400 });
      }
      if (!document) {
        return NextResponse.json({ error: "document required" }, { status: 400 });
      }
      const raw = await runPython(
        "manage_brain.py",
        ["chroma_add", collection, document, JSON.stringify(metadata)],
        { timeout: 15000 }
      );
      return NextResponse.json(safeJsonParse(raw, { error: "Failed to parse response" }));
    }

    if (action === "chroma_delete") {
      const { collection, entry_id } = body;
      if (!collection) {
        return NextResponse.json({ error: "collection required" }, { status: 400 });
      }
      if (!entry_id) {
        return NextResponse.json({ error: "entry_id required" }, { status: 400 });
      }
      const raw = await runPython(
        "manage_brain.py",
        ["chroma_delete", collection, entry_id],
        { timeout: 15000 }
      );
      return NextResponse.json(safeJsonParse(raw, { error: "Failed to parse response" }));
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    const msg = String(err);
    // manage_brain.py exits 3 for sacred / HUB_BRAIN_EDIT_ENABLED-off rejection —
    // map to 423 Locked (mirrors /api/memory/brain/[name]).
    if (msg.includes("python exit=3")) {
      return NextResponse.json({ error: msg }, { status: 423 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
