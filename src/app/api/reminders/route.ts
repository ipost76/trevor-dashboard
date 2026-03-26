import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const all = request.nextUrl.searchParams.get("all") === "true";
  try {
    const raw = runPython("query_reminders.py", ["list", ...(all ? ["all"] : [])]);
    return NextResponse.json(safeJsonParse(raw, { reminders: [] }));
  } catch (err) {
    return NextResponse.json({ reminders: [], error: String(err) });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const raw = runPython("query_reminders.py", ["add", JSON.stringify(body)]);
    return NextResponse.json(safeJsonParse(raw, { error: "Unknown" }));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
