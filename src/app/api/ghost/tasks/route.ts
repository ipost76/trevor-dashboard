import { NextRequest, NextResponse } from "next/server";
import { ghostJson } from "@/lib/ghost-api";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const filters: Record<string, string> = {};
    if (sp.get("status")) filters.status = sp.get("status")!;
    if (sp.get("priority")) filters.priority = sp.get("priority")!;
    if (sp.get("category")) filters.category = sp.get("category")!;
    const data = ghostJson("tasks", "list", JSON.stringify(filters));
    const stats = ghostJson("tasks", "stats");
    return NextResponse.json({ ...data, stats });
  } catch (e) {
    return NextResponse.json({ items: [], total: 0, stats: {}, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.title) return NextResponse.json({ error: "title required" }, { status: 400 });
    return NextResponse.json(ghostJson("tasks", "create", JSON.stringify(body)), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
