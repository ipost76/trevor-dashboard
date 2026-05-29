import { NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stdout = await runPython("query_chat_budget.py", []);
    return NextResponse.json(JSON.parse(stdout));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 200 });
  }
}
