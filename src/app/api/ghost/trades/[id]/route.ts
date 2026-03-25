import { NextRequest, NextResponse } from "next/server";
import { ghostJson } from "@/lib/ghost-api";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const data = ghostJson("trades", "get", id);
    if (data.error) return NextResponse.json(data, { status: 404 });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    // Special: close trade with exit_price
    if (body.exit_price != null && body._action === "close") {
      const data = ghostJson("trades", "close_trade", id, String(body.exit_price));
      return NextResponse.json(data);
    }
    const data = ghostJson("trades", "update", id, JSON.stringify(body));
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const data = ghostJson("trades", "delete", id);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
