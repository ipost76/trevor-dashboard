import { NextRequest, NextResponse } from "next/server";
import { ghostJson } from "@/lib/ghost-api";
export const dynamic = "force-dynamic";

export async function GET(_r: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const { id } = await params; return NextResponse.json(ghostJson("notes", "get", id)); }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const { id } = await params; const body = await req.json(); return NextResponse.json(ghostJson("notes", "update", id, JSON.stringify(body))); }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
export async function DELETE(_r: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const { id } = await params; return NextResponse.json(ghostJson("notes", "delete", id)); }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
