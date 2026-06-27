import { NextRequest, NextResponse } from "next/server";
import { callGateway, gatewayResponse } from "@/lib/gateway-client";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trade_id } = body;
    // RR2 C-8: coerce entry_price to a number — a string body value would make the
    // fmt()/arithmetic below NaN or throw (e.g. n.toFixed on a string). Matches the
    // Number(...) wrapping already used for leverage/stop_price below.
    const entry_price = Number(body.entry_price);

    if (!trade_id || !Number.isFinite(entry_price) || entry_price <= 0) {
      return NextResponse.json({ error: "trade_id and positive entry_price required" }, { status: 400 });
    }

    // W-C-P2a: DB write routes through the gateway → VM (HUB_TRADE_EDIT_ENABLED,
    // audited). The helper result still comes back so the Discord card edit
    // below is unchanged.
    const gw = await callGateway(
      "trades.edit_entry",
      { trade_id, entry_price },
      { reason: "trades.edit_entry via Hub" },
    );
    if (gw.status !== 200) {
      return gatewayResponse(gw);
    }
    const result = ((gw.body.result ?? gw.body) || {}) as Record<string, unknown>;

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
