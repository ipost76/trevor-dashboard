import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const raw = runPython("manage_portfolio.py", ["list"]);
    const data = safeJsonParse(raw, { positions: [] });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ positions: [], error: String(err) });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const ticker = (body.ticker || "").toUpperCase();
    const direction = (body.direction || "long").toLowerCase();
    const entryPrice = String(body.entry_price ?? "");
    const quantity = String(body.quantity ?? "1");
    const leverage = String(body.leverage ?? "1");
    const assetType = body.asset_type || "auto";
    const notes = body.notes || "";

    if (!ticker) {
      return NextResponse.json({ error: "Ticker required" }, { status: 400 });
    }
    if (!entryPrice || isNaN(Number(entryPrice)) || Number(entryPrice) <= 0) {
      return NextResponse.json(
        { error: "Valid entry_price required" },
        { status: 400 }
      );
    }

    const raw = runPython("manage_portfolio.py", [
      "add",
      ticker,
      direction,
      entryPrice,
      quantity,
      leverage,
      assetType,
      notes,
    ]);
    const data = safeJsonParse(raw, { error: "Failed to parse response" });

    if (data.error) {
      return NextResponse.json(data, { status: 400 });
    }
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const id = body.id;

    if (!id) {
      return NextResponse.json(
        { error: "Position id required" },
        { status: 400 }
      );
    }

    // Extract fields to update (everything except id)
    const { id: _id, ...fields } = body;

    if (Object.keys(fields).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const fieldsJson = JSON.stringify(fields);
    const raw = runPython("manage_portfolio.py", [
      "update",
      String(id),
      fieldsJson,
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

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const id = body.id;

    if (!id) {
      return NextResponse.json(
        { error: "Position id required" },
        { status: 400 }
      );
    }

    const raw = runPython("manage_portfolio.py", ["remove", String(id)]);
    const data = safeJsonParse(raw, { error: "Failed to parse response" });

    if (data.error) {
      return NextResponse.json(data, { status: 400 });
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
