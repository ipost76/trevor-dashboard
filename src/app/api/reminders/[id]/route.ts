import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const body = await request.json();
    const action = body.action as string;
    if (action === "complete") {
      const raw = runPython("query_reminders.py", ["complete", id]);
      return NextResponse.json(safeJsonParse(raw, { error: "Unknown" }));
    }
    if (action === "cancel") {
      const raw = runPython("query_reminders.py", ["cancel", id]);
      return NextResponse.json(safeJsonParse(raw, { error: "Unknown" }));
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const body = await request.json();
    const data = { ...body, id: parseInt(id) };
    const raw = runPython("query_reminders.py", ["update", JSON.stringify(data)]);
    return NextResponse.json(safeJsonParse(raw, { error: "Unknown" }));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const raw = runPython("query_reminders.py", ["delete", id]);
    return NextResponse.json(safeJsonParse(raw, { error: "Unknown" }));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
