import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const scriptPath = join(process.cwd(), "manage_watchlist.py");

  try {
    const { execSync } = await import("child_process");
    const raw = execSync(
      `${pythonPath} ${scriptPath} list`,
      { encoding: "utf-8", timeout: 10000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
    ).trim();
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json({ items: [], error: String(err) });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const ticker = (body.ticker || "").toUpperCase();
  const mode = body.mode || "scalp";

  if (!ticker) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const scriptPath = join(process.cwd(), "manage_watchlist.py");

  try {
    const { execSync } = await import("child_process");
    const raw = execSync(
      `${pythonPath} ${scriptPath} add "${ticker}" "${mode}"`,
      { encoding: "utf-8", timeout: 10000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
    ).trim();
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get("ticker") || "").toUpperCase();
  const mode = searchParams.get("mode") || "scalp";

  if (!ticker) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const scriptPath = join(process.cwd(), "manage_watchlist.py");

  try {
    const { execSync } = await import("child_process");
    const raw = execSync(
      `${pythonPath} ${scriptPath} remove "${ticker}" "${mode}"`,
      { encoding: "utf-8", timeout: 10000, cwd: trevorDir, env: { ...process.env, HOME: "/home/trevor" } }
    ).trim();
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
