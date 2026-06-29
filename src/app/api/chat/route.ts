import { NextRequest, NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// All Python crosses the boundary via the async bridge (argv array / stdin bytes,
// NO shell). The bridge runs the venv python3 with cwd=TREVOR_DIR and resolves the
// script relative to DASHBOARD_DIR — identical to the prior local helper, now async
// so a slow/hung child can never block the event loop.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || searchParams.get("scope") || "health";

  try {
    if (action === "health") {
      const raw = await runPython("chat_bridge.py", ["health"], { timeout: 10000 });
      return NextResponse.json(JSON.parse(raw));
    }

    if (action === "history") {
      // Whitelist: 1-4 digit integer only. chat_bridge.py does int(argv[2]).
      const limitRaw = searchParams.get("limit") || "50";
      const limit = /^\d{1,4}$/.test(limitRaw) ? limitRaw : "50";
      const raw = await runPython("chat_bridge.py", ["history", limit], { timeout: 15000 });
      return NextResponse.json(JSON.parse(raw));
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) });
  }
}

// [B3] Hub read-only lockdown (2026-06-28): the POST write surface (chat_bridge.py
// chat + chat_ai.py — wrote the VM chat log) was removed, along with its in-memory
// rate-limit. Only the GET read (health/history) remains; the path 405s on a write
// verb. NB the chat *stream* write lives in a separate gateway-backed route
// (/api/chat/stream → chat.log_user/log_assistant ops), killed at ops.js (Phase 2).
