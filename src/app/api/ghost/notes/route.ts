import { NextRequest, NextResponse } from "next/server";
import { ghostJson } from "@/lib/ghost-api";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const filters: Record<string, string> = {};
    if (sp.get("category")) filters.category = sp.get("category")!;
    if (sp.get("pinned")) filters.pinned = sp.get("pinned")!;
    return NextResponse.json(ghostJson("notes", "list", JSON.stringify(filters)));
  } catch (e) {
    return NextResponse.json({ items: [], total: 0, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.title || !body.content) return NextResponse.json({ error: "title and content required" }, { status: 400 });
    return NextResponse.json(ghostJson("notes", "create", JSON.stringify(body)), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
