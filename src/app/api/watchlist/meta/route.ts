import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

export const dynamic = "force-dynamic";

type WatchMeta = Record<string, { category: string; description: string }>;

const CATEGORIES: Record<string, string> = {
  crypto_perp: "Crypto Perps (Scalp)",
  crypto_spot: "Crypto Spot (Long-Term)",
  equity: "Equities",
  etf: "ETFs",
  speculative: "Speculative",
};

function getMetaPath(): string {
  const dir = join(process.cwd(), "data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "watchlist-meta.json");
}

function readMeta(): WatchMeta {
  const p = getMetaPath();
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return {}; }
}

function writeMeta(meta: WatchMeta) {
  writeFileSync(getMetaPath(), JSON.stringify(meta, null, 2), "utf-8");
}

function autoCategory(ticker: string, notes: string): string {
  if (ticker.endsWith("-PERP")) return "crypto_perp";
  if (notes.includes("type=crypto_spot")) return "crypto_spot";
  if (notes.includes("type=etf")) return "etf";
  if (notes.includes("type=crypto_perp")) return "crypto_perp";
  const cryptos = ["BTC", "ETH", "SOL", "DOGE", "ADA", "HYPE", "FARTCOIN", "AVAX", "LINK", "DOT"];
  if (cryptos.includes(ticker)) return "crypto_spot";
  const etfs = ["GLD", "SLV", "SPY", "QQQ", "VGT", "SOXL", "OIH", "ITA", "IRE", "TLT", "XLF"];
  if (etfs.includes(ticker)) return "etf";
  return "equity";
}

function autoDescription(ticker: string, category: string): string {
  switch (category) {
    case "crypto_perp": return `${ticker.replace("-PERP", "")} perp scalp`;
    case "crypto_spot": return `${ticker} spot — long-term hold`;
    case "etf": return `${ticker} ETF`;
    case "speculative": return `${ticker} speculative`;
    default: return `${ticker} equity`;
  }
}

export async function GET() {
  try {
    const { execSync } = await import("child_process");
    const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
    const pythonPath = join(trevorDir, "venv", "bin", "python3");
    const dashboardDir = process.cwd();
    const scriptPath = join(dashboardDir, "query_trades.py");

    const raw = execSync(`${pythonPath} ${scriptPath} watchlist`, {
      encoding: "utf-8", timeout: 10000, cwd: trevorDir,
      env: { ...process.env, HOME: "/home/trevor" },
    }).trim();

    const dbItems: Array<{
      id: number; ticker: string; reason: string; priority: number;
      mode: string; asset_type: string; notes: string; added_at: string;
    }> = JSON.parse(raw).items || [];

    const meta = readMeta();

    // Merge DB items with Hub-side metadata
    const items = dbItems.map(item => {
      const m = meta[item.ticker];
      const category = m?.category || autoCategory(item.ticker, item.notes || "");
      const hasJunkDescription = (item.reason || "").includes("Added via chat:");
      const description = m?.description || (hasJunkDescription ? autoDescription(item.ticker, category) : item.reason || "");
      return {
        id: item.id,
        ticker: item.ticker,
        strategy: item.mode || "lt",
        category,
        description,
        asset_type: item.asset_type || "stock",
        original_reason: item.reason || "",
        priority: item.priority,
        added_at: item.added_at,
        hasJunkDescription,
      };
    });

    // Build category counts
    const categories: Record<string, { label: string; count: number }> = {};
    for (const item of items) {
      if (!categories[item.category]) {
        categories[item.category] = { label: CATEGORIES[item.category] || item.category, count: 0 };
      }
      categories[item.category].count++;
    }

    return NextResponse.json({ items, categories });
  } catch (err) {
    return NextResponse.json({ items: [], categories: {}, error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticker, description, category } = body as { ticker: string; description?: string; category?: string };

    if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

    const meta = readMeta();
    const existing = meta[ticker] || { category: "equity", description: "" };
    if (description !== undefined) existing.description = description;
    if (category !== undefined) existing.category = category;
    meta[ticker] = existing;
    writeMeta(meta);

    return NextResponse.json({ ok: true, ticker, ...existing });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // Batch cleanup: replace all "Added via chat:" descriptions with clean ones
  try {
    const { execSync } = await import("child_process");
    const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
    const pythonPath = join(trevorDir, "venv", "bin", "python3");
    const dashboardDir = process.cwd();
    const scriptPath = join(dashboardDir, "query_trades.py");

    const raw = execSync(`${pythonPath} ${scriptPath} watchlist`, {
      encoding: "utf-8", timeout: 10000, cwd: trevorDir,
      env: { ...process.env, HOME: "/home/trevor" },
    }).trim();

    const dbItems: Array<{ ticker: string; reason: string; notes: string }> = JSON.parse(raw).items || [];
    const meta = readMeta();
    let cleaned = 0;

    for (const item of dbItems) {
      if ((item.reason || "").includes("Added via chat:") && !meta[item.ticker]?.description) {
        const category = meta[item.ticker]?.category || autoCategory(item.ticker, item.notes || "");
        meta[item.ticker] = {
          category,
          description: autoDescription(item.ticker, category),
        };
        cleaned++;
      }
    }

    writeMeta(meta);
    return NextResponse.json({ ok: true, cleaned });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
