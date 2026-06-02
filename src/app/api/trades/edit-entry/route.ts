import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trade_id, entry_price } = body;

    if (!trade_id || !entry_price || entry_price <= 0) {
      return NextResponse.json({ error: "trade_id and positive entry_price required" }, { status: 400 });
    }

    // Update DB via Python helper
    const raw = await runPython("query_edit_entry.py", [trade_id, String(entry_price)]);
    const result = safeJsonParse<Record<string, unknown>>(raw, { error: "Unknown error" });

    if (result.error) {
      return NextResponse.json(result, { status: 400 });
    }

    // Try to update Discord card
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (botToken && result.card_msg_id && result.card_channel_id) {
      try {
        const dir = String(result.direction || "LONG");
        const emoji = dir === "LONG" ? "🟢" : "🔴";
        const lev = Number(result.leverage) || 1;
        const levStr = lev === Math.floor(lev) ? `${Math.floor(lev)}x` : `${lev}x`;
        const fmt = (n: number) => {
          if (!n) return "—";
          if (n < 0.01) return `$${n.toFixed(6)}`;
          if (n < 1) return `$${n.toFixed(4)}`;
          if (n < 100) return `$${n.toFixed(4)}`;
          return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        };
        const eStr = fmt(entry_price);
        const sStr = result.stop_price ? fmt(Number(result.stop_price)) : "—";
        const tgt = Number(result.profit_target_price) || Number(result.target_price) || 0;
        const tStr = tgt ? fmt(tgt) : "—";
        let tlp = "";
        if (tgt && entry_price > 0) {
          const tr = Math.abs(tgt - entry_price) / entry_price * 100;
          tlp = ` (+${Math.round(tr * lev)}% lev)`;
        }
        const content = `${emoji} **${String(result.ticker)} ${dir}** — LIVE\n${eStr} • ${levStr} • Stop ${sStr} • Target ${tStr}${tlp}`;

        await fetch(
          `https://discord.com/api/v10/channels/${result.card_channel_id}/messages/${result.card_msg_id}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bot ${botToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ content }),
            // REL-11 (2026-06-02): bound the Discord round-trip so an
            // unresponsive API can't hang the request. AbortError lands in the
            // existing non-fatal catch below — DB stays the source of truth.
            signal: AbortSignal.timeout(5000),
          }
        );
      } catch (discordErr) {
        console.error("[EDIT-ENTRY] Discord card edit failed:", discordErr);
        // Non-fatal — DB is source of truth
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
