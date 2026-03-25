import { NextRequest, NextResponse } from "next/server";
import { ghostJson } from "@/lib/ghost-api";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const filters: Record<string, string> = {};
    if (sp.get("status")) filters.status = sp.get("status")!;
    if (sp.get("type")) filters.type = sp.get("type")!;
    if (sp.get("topic")) filters.topic = sp.get("topic")!;
    const data = ghostJson("training", "list", JSON.stringify(filters));
    const stats = ghostJson("training", "stats");
    return NextResponse.json({ ...data, stats });
  } catch (e) {
    return NextResponse.json({ items: [], total: 0, stats: {}, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.title) return NextResponse.json({ error: "title required" }, { status: 400 });
    return NextResponse.json(ghostJson("training", "create", JSON.stringify(body)), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
