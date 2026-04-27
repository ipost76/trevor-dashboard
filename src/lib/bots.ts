// Multi-bot Auto Trader hub — central config registry.
// Adding a new bot: append a BotConfig entry, build a section component,
// (eventually) add API routes under /api/<id>/*.

export type BotStatus = "active" | "not_connected" | "offline" | "error";
export type BotMode = "paper" | "live";

export interface BotConfig {
  id: string;
  name: string;
  icon: string;
  accentColor: string;
  status: BotStatus;
  tickers: string[];
  exchange: string;
  capital: number;
  mode: BotMode;
  description?: string;
  apiBasePath?: string;
  scrollAnchorId: string;
}

export const SCALPER_CONFIG: BotConfig = {
  id: "scalper",
  name: "SCALPER",
  icon: "🔪",
  accentColor: "#00ff88",
  status: "active",
  tickers: ["BTC", "ETH", "SOL", "HYPE", "FARTCOIN"],
  exchange: "Hyperliquid Perps",
  capital: 50,
  mode: "paper",
  apiBasePath: "/api/auto-trader",
  scrollAnchorId: "bot-scalper",
};

export const DEGEN_CONFIG: BotConfig = {
  id: "degen",
  name: "DEGEN",
  icon: "💀",
  accentColor: "#ff00ff",
  status: "not_connected",
  tickers: ["ALL"],
  exchange: "Hyperliquid Perps",
  capital: 50,
  mode: "paper",
  description: "Meme/Low-Cap Focus",
  apiBasePath: "/api/degen",
  scrollAnchorId: "bot-degen",
};

export const BOT_CONFIGS: BotConfig[] = [SCALPER_CONFIG, DEGEN_CONFIG];
