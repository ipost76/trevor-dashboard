import { NextRequest, NextResponse } from "next/server";
import { ghostJson } from "@/lib/ghost-api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const filters: Record<string, string> = {};
    if (sp.get("outcome")) filters.outcome = sp.get("outcome")!;
    if (sp.get("ticker")) filters.ticker = sp.get("ticker")!;
    if (sp.get("direction")) filters.direction = sp.get("direction")!;
    const limit = sp.get("limit") || "50";
    const offset = sp.get("offset") || "0";
    const data = ghostJson("trades", "list", JSON.stringify(filters), "created_at DESC", limit, offset);
    const stats = ghostJson("trades", "stats");
    return NextResponse.json({ ...data, stats });
  } catch (e) {
    return NextResponse.json({ items: [], total: 0, stats: {}, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.ticker || !body.direction) {
      return NextResponse.json({ error: "ticker and direction required" }, { status: 400 });
    }
    const data: Record<string, unknown> = {
      ticker: body.ticker.toUpperCase(),
      direction: body.direction.toUpperCase(),
    };
    if (body.entry_price != null) data.entry_price = body.entry_price;
    if (body.leverage != null) data.leverage = body.leverage;
    if (body.stop_loss != null) data.stop_loss = body.stop_loss;
    if (body.target != null) data.target = body.target;
    if (body.notes) data.notes = body.notes;
    if (body.tags) data.tags = body.tags;
    if (body.source) data.source = body.source;
    const result = ghostJson("trades", "create", JSON.stringify(data));
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
