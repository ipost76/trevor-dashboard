import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || isNaN(Number(id))) {
      return NextResponse.json(
        { error: "Valid position id required" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const exitPrice = body.exit_price;

    if (
      exitPrice === undefined ||
      exitPrice === null ||
      isNaN(Number(exitPrice)) ||
      Number(exitPrice) <= 0
    ) {
      return NextResponse.json(
        { error: "Valid exit_price required" },
        { status: 400 }
      );
    }

    const raw = runPython("manage_portfolio.py", [
      "close",
      id,
      String(exitPrice),
    ]);
    const data = safeJsonParse(raw, { error: "Failed to parse response" });

    if (data.error) {
      return NextResponse.json(data, { status: 400 });
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
