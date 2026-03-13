import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params;

  // Validate date format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
  }

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const filePath = join(trevorDir, "brain", "memory", `${date}.md`);

  try {
    const fs = await import("fs");
    const content = fs.readFileSync(filePath, "utf-8");
    return NextResponse.json({ date, content });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
