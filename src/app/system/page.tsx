"use client";
import { useState } from "react";

const C = {
  bg: "var(--background)",
  card: "var(--card)",
  cardHover: "var(--accent)",
  border: "var(--border)",
  accent: "var(--neon-cyan)",
  accentDim: "rgba(0, 240, 255, 0.13)",
  warning: "var(--neon-amber)",
  danger: "var(--neon-red)",
  info: "#3388ff",
  purple: "#8855ff",
  yellow: "#ffcc00",
  cyan: "var(--neon-cyan)",
  text: "var(--foreground)",
  textDim: "var(--muted-foreground)",
  textBright: "#ffffff",
  green: "var(--neon-green)",
};

const VIEWS = [
  { id: "overview", label: "SYSTEM OVERVIEW" },
  { id: "signal", label: "SIGNAL PIPELINE" },
  { id: "trade", label: "TRADE LIFECYCLE" },
  { id: "memory", label: "MEMORY SYSTEM" },
  { id: "commands", label: "ALL COMMANDS" },
  { id: "services", label: "SERVICES & INFRA" },
];

function Section({ title, subtitle, color, children, defaultOpen = false }: {
  title: string; subtitle?: string; color: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          background: C.card, border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
          borderLeft: `3px solid ${color}`, padding: "10px 14px", cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}
      >
        <div>
          <span style={{ color, fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>{title}</span>
          {subtitle && <span style={{ color: C.textDim, fontSize: 10, marginLeft: 10 }}>{subtitle}</span>}
        </div>
        <span style={{ color, fontSize: 14 }}>{open ? "▼" : "▶"}</span>
      </div>
      {open && (
        <div style={{ padding: "10px 14px", background: C.card, borderLeft: `3px solid color-mix(in srgb, ${color} 20%, transparent)`, opacity: 0.95 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function Node({ label, detail, status, file, color = C.accent }: {
  label: string; detail?: string; status?: string; file?: string; color?: string;
}) {
  const [open, setOpen] = useState(false);
  const sc: Record<string, string> = { active: C.green, protected: C.info, sacred: C.yellow, new: C.cyan, buggy: C.danger };
  const sl: Record<string, string> = { active: "LIVE", protected: "PROTECTED", sacred: "SACRED", new: "NEW v2.0", buggy: "KNOWN BUG" };
  return (
    <div
      onClick={() => setOpen(!open)}
      style={{
        background: open ? C.cardHover : C.card,
        border: `1px solid ${open ? (sc[status || ""] || color) : C.border}`,
        padding: "8px 12px", marginBottom: 4, cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
        <span style={{ fontSize: 11, color: C.textBright, fontWeight: 600 }}>{label}</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {file && <span style={{ fontSize: 9, color: C.textDim }}>{file}</span>}
          {status && (
            <span style={{
              fontSize: 8, color: sc[status] || C.textDim,
              border: `1px solid color-mix(in srgb, ${sc[status] || C.textDim} 30%, transparent)`,
              padding: "1px 5px", letterSpacing: 1,
            }}>
              {sl[status] || status}
            </span>
          )}
        </div>
      </div>
      {open && detail && (
        <div style={{ fontSize: 10, color: C.text, marginTop: 6, lineHeight: 1.5, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
          {detail}
        </div>
      )}
    </div>
  );
}

function Step({ num, label, detail, color }: { num: string; label: string; detail: string; color: string }) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
      <div style={{
        minWidth: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
        color, fontSize: 10, fontWeight: 700, flexShrink: 0,
      }}>
        {num}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 10, color: C.text, marginTop: 2, lineHeight: 1.4 }}>{detail}</div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, padding: "8px 10px", textAlign: "center" }}>
      <div style={{ fontSize: 18, color: C.accent, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 9, color: C.textDim, letterSpacing: 1, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 8, color: C.textDim, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

export default function SystemPage() {
  const [activeView, setActiveView] = useState("overview");

  return (
    <div className="flex-1 overflow-auto p-3">
      <div className="panel-header mb-3">SYSTEM MAP</div>

      {/* View Tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 16, flexWrap: "wrap" }}>
        {VIEWS.map(v => (
          <button
            key={v.id}
            onClick={() => setActiveView(v.id)}
            style={{
              padding: "6px 12px", fontSize: 10, fontWeight: 700, letterSpacing: 1,
              background: activeView === v.id ? C.accentDim : "transparent",
              color: activeView === v.id ? C.accent : C.textDim,
              border: `1px solid ${activeView === v.id ? C.accent : C.border}`,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* ═══════════ OVERVIEW ═══════════ */}
      {activeView === "overview" && (
        <div>
          {/* Stats Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 16 }}>
            <Stat label="PYTHON FILES" value="21" sub="Active modules" />
            <Stat label="DISCORD CHANNELS" value="11" sub="4 categories" />
            <Stat label="SQLITE TABLES" value="15" sub="WAL mode" />
            <Stat label="CHROMADB COLLECTIONS" value="7+" sub="Vector memory" />
            <Stat label="TRAINING TRADES" value="432K+" sub="22 tickers" />
            <Stat label="AI AGENTS" value="4+1" sub="Haiku + Sonnet" />
          </div>

          <Section title="CORE MODULES" subtitle="Main Python files" color={C.accent} defaultOpen>
            <Node label="main.py" detail="Entry point — initializes 11 components, starts Discord bot via asyncio.run(). Creates Memory, MarketData, VectorMemory, XPSystem, SimEngine, TrainingBridge, SwarmsBrain, AlertFormatter, DualTrackEngine, SessionManager, SecurityAgent, then TREVORBot." file="main.py" status="active" />
            <Node label="discord_bot.py" detail="TREVORBot class — 25+ slash commands, 7 background scan loops, on_message routing, signal/trade lifecycle handlers. ~2400 lines. Handles TAKE/SKIP/WIN/LOSS/SCRATCH flow." file="discord_bot.py" status="active" />
            <Node label="swarms_brain.py" detail="4 Haiku agents (tech, news, risk, macro) → Sonnet Synthesis Agent. Budget-gated ($0.25/day). analyze_ticker() runs full swarm pipeline. v2.0: now injects trade history context + KB context into Synthesis." file="swarms_brain.py" status="active" />
            <Node label="memory.py" detail="SQLite interface — 15 tables, WAL mode. Watchlist, XP ledger, cost tracking, trade insights/outcomes, alert cooldowns, email triage log. add_xp() has floor at 0." file="memory.py" status="active" />
            <Node label="market_data.py" detail="Multi-source price data: yfinance (primary), Alpaca, Alpha Vantage, CoinGecko, Binance. Thread-safe yfinance with global lock. Strips -PERP suffix for crypto lookups." file="market_data.py" status="active" />
            <Node label="vector_memory.py" detail="ChromaDB interface — 7 collections with SentenceTransformer embeddings (all-MiniLM-L6-v2). Semantic search for training recall, pattern matching." file="vector_memory.py" status="active" />
          </Section>

          <Section title="TRADING ENGINES" subtitle="Zero AI cost scanners" color={C.green}>
            <Node label="scalp_engine.py" detail="Pure-TA 5-minute scalp scoring — 9 technical indicators (RSI, MACD, BBands, VWAP, OBV, ATR, Stoch, ADX, EMA cross). Score 0-100, threshold >= 63. Zero AI cost per scan." file="scalp_engine.py" status="active" />
            <Node label="lt_engine.py" detail="Pure-TA daily/4H long-term scoring — 10 indicators. Score 0-100, threshold >= 80. Covers stocks + crypto spot." file="lt_engine.py" status="active" />
            <Node label="dual_track_engine.py" detail="Unified orchestrator for both engines. run_scalp() and run_lt() methods. Filters out NEUTRAL direction signals." file="dual_track_engine.py" status="active" />
            <Node label="alert_formatter.py" detail="Discord embed/card builders — format_scalp_v2(), format_lt_v2(). Generates signal cards with entry/stop/target, confidence bar, Reply TAKE/SKIP footer." file="alert_formatter.py" status="active" />
          </Section>

          <Section title="v2.0 MODULES" subtitle="New in this upgrade" color={C.cyan}>
            <Node label="memory_pipeline.py" detail="Daily memory generation, weekly MEMORY.md distillation (via Haiku ~$0.01), HEARTBEAT.md auto-update, trade pattern summaries in ChromaDB trade_patterns collection, ticker trade history queries." file="memory_pipeline.py" status="new" />
            <Node label="knowledge_base.py" detail="ChromaDB knowledge_base collection. Ingest text/URLs, Haiku extracts key insights (~$0.005/call), MD5 dedup, semantic search. Injected into Synthesis Agent for signal context." file="knowledge_base.py" status="new" />
            <Node label="orchestrator.py" detail="Cron-based scheduling engine — tick loop every 60s. 5 jobs: morning briefing, EOD review, daily memory capture, weekly distillation, heartbeat update. Reads cron_schedule.json." file="orchestrator.py" status="new" />
            <Node label="signal_quality.py" detail="Calibration analysis (confidence buckets vs actual win rate), per-ticker performance breakdown, overall trading stats (win rate, P&L, profit factor)." file="signal_quality.py" status="new" />
          </Section>

          <Section title="SUPPORT MODULES" color={C.purple}>
            <Node label="training_bridge.py" detail="Historical pattern recall — pure SQLite queries against 432K training trades. No ChromaDB. Provides training context to Synthesis Agent." file="training_bridge.py" status="active" />
            <Node label="xp_system.py" detail="15-rank gamification (Intern Quant → CEO). XP awarded only on trade close in discord_bot. Hard scale: WIN +2 to +20, LOSS -3 to -10. Floor at 0." file="xp_system.py" status="active" />
            <Node label="session_manager.py" detail="Session state management + brain file updates. Writes daily memory files to brain/memory/. Tracks message count, cost, session duration." file="session_manager.py" status="active" />
            <Node label="security_agent.py" detail="File integrity monitoring — tracks hashes of critical files, alerts on unexpected changes." file="security_agent.py" status="active" />
            <Node label="email_triage.py" detail="IMAP email triage agent for ipost76@yahoo.com. Daily scan at 8pm ET. Classifies emails, auto-deletes with 3-attempt retry + exponential backoff." file="email_triage.py" status="active" />
            <Node label="config.py" detail="Environment variable loader, path constants. Reads from .env file." file="config.py" status="active" />
            <Node label="n8n_bridge.py" detail="FastAPI bridge on port 8765 for n8n workflow orchestration. SwarmsBrain(mem, mkt, None) — no VectorMemory (ChromaDB single-writer conflict)." file="n8n_bridge.py" status="active" />
          </Section>
        </div>
      )}

      {/* ═══════════ SIGNAL PIPELINE ═══════════ */}
      {activeView === "signal" && (
        <div>
          <Section title="SIGNAL GENERATION FLOW" color={C.green} defaultOpen>
            <Step num="1" label="Scan Loop Triggers" detail="scalp_scan_loop runs every 5 minutes (perp watchlist only). lt_scan_loop runs every 4 hours (all assets). Both use DualTrackEngine for scoring." color={C.green} />
            <Step num="2" label="Technical Analysis" detail="ScalpEngine: 9 indicators (RSI, MACD, BBands, VWAP, OBV, ATR, Stoch, ADX, EMA cross). LTEngine: 10 indicators. Score 0-100. Zero AI cost." color={C.green} />
            <Step num="3" label="Direction Filter" detail="NEUTRAL direction signals are blocked at 3 layers: engine level (returns None), scan loop gate (direction in LONG/SHORT), and /scalp command." color={C.warning} />
            <Step num="4" label="Threshold Gate" detail="Scalp: score >= 63. Long-term: score >= 80. Below threshold = signal dropped silently." color={C.green} />
            <Step num="5" label="Dedup Check" detail="_signal_dedup dict with 5-minute TTL. Same ticker+direction won't re-post within 5 minutes." color={C.green} />
            <Step num="6" label="AI Swarm Analysis" detail="If score passes threshold, SwarmsBrain.analyze_ticker() runs full 4+1 pipeline: Tech Analyst, News Analyst, Risk Assessor, Macro Analyst (all Haiku) → Synthesis Agent (Sonnet). ~$0.03 per call." color={C.accent} />
            <Step num="7" label="Discord Signal Post" detail="Signal card posted to #scalp-signals or #long-term-signals with entry, stop, target, confidence bar, and Reply TAKE/SKIP footer." color={C.accent} />
          </Section>

          <Section title="SWARM BRAIN PIPELINE" subtitle="4 Haiku + 1 Sonnet" color={C.purple}>
            <Node label="Tech Analyst (Haiku)" detail="Analyzes price action, support/resistance, technical indicators. Receives market data context." status="active" />
            <Node label="News Analyst (Haiku)" detail="Evaluates recent news sentiment and catalysts for the ticker." status="active" />
            <Node label="Risk Assessor (Haiku)" detail="Assesses market risk, volatility regime, correlation risks." status="active" />
            <Node label="Macro Analyst (Haiku)" detail="Macro environment analysis — Fed policy, sector rotation, earnings calendar." status="active" />
            <Node label="Synthesis Agent (Sonnet)" detail="Combines all 4 agent outputs + training context + trade history (v2.0) + KB context (v2.0). Produces final signal with confidence, entry, stop, target, reasoning." status="active" />
          </Section>

          <Section title="v2.0 CONTEXT INJECTION" subtitle="New data flowing into Synthesis" color={C.cyan}>
            <Node label="Trade History Context" detail="_get_trade_history_context(ticker): queries last 10 trades for the ticker from trade_outcomes. Shows win/loss record, average P&L, last trade result. Helps Synthesis learn from past performance." status="new" />
            <Node label="Knowledge Base Context" detail="_get_kb_context(ticker): semantic search in knowledge_base ChromaDB collection. Returns relevant research articles, analysis notes. Informs Synthesis with external knowledge." status="new" />
            <Node label="Training Bridge Context" detail="Existing: queries 432K training trades for historical patterns. Pattern recall from SQLite." status="active" />
          </Section>
        </div>
      )}

      {/* ═══════════ TRADE LIFECYCLE ═══════════ */}
      {activeView === "trade" && (
        <div>
          <Section title="SCALP TRADE FLOW" color={C.green} defaultOpen>
            <Step num="1" label="Signal Posted → #scalp-signals" detail="Bot posts signal card with ticker, direction, entry, stop, target, confidence. Card stored in _pending_signals[message_id]." color={C.green} />
            <Step num="2" label="Ghost Replies TAKE [leverage]" detail="Reply to signal card. Default leverage=1.0. Bot creates trade dict in _open_trades[user_id], posts live trade card to #active-trades." color={C.accent} />
            <Step num="3" label="Signal Cleanup" detail="Original signal message + Ghost's reply deleted from #scalp-signals. Keeps channel clean." color={C.textDim} />
            <Step num="4" label="Ghost Replies WIN/LOSS/SCRATCH [exit_price]" detail="Reply to trade card in #active-trades. 25% price sanity check on exit price vs entry. Calculates P&L." color={C.green} />
            <Step num="5" label="Outcome Recorded" detail="trade_outcomes row created. XP awarded (WIN: +2 to +20, LOSS: -3 to -10, SCRATCH: +1). XP card posted to #xp-logs." color={C.accent} />
            <Step num="6" label="Trade Card Cleanup" detail="Confirmation message auto-deletes after 5 minutes. Trade removed from _open_trades." color={C.textDim} />
          </Section>

          <Section title="SKIP FLOW" color={C.warning}>
            <Step num="1" label="Ghost Replies SKIP" detail="Signal message + Ghost's reply deleted from channel. 'Skipped' confirmation auto-deletes after 5 seconds. 0 XP awarded." color={C.warning} />
          </Section>

          <Section title="LONG-TERM TRADE FLOW" color={C.purple}>
            <Step num="1" label="Signal Posted → #long-term-signals" detail="LT signal card with BUILDING/WATCHING/SKIP options." color={C.purple} />
            <Step num="2" label="Ghost Replies BUILDING" detail="Creates position card in #lt-active-trades. Same lifecycle as scalp after this point." color={C.purple} />
          </Section>

          <Section title="TRADE DATA STORAGE" color={C.accent}>
            <Node label="trade_insights" detail="Signal metadata: ticker, signal_type, confidence (0-1), entry/target/stop prices, reasoning, technical_summary, macro_context, news_sentiment, earnings_risk, swarm_consensus, strategy, timeframe, multi_tf_confirmed." file="memory.py" status="active" />
            <Node label="trade_outcomes" detail="Trade results: insight_id (FK), ticker, open/close/entry/exit prices, hold_time_minutes, exit_reason, pnl_pct, leveraged_pnl_pct, direction, leverage, raw_pnl_pct, lessons, excluded flag." file="memory.py" status="active" />
            <Node label="xp_ledger" detail="XP history: amount, reason (e.g. 'win +20.0%'), category (trade/manual), created_at." file="memory.py" status="active" />
          </Section>
        </div>
      )}

      {/* ═══════════ MEMORY SYSTEM ═══════════ */}
      {activeView === "memory" && (
        <div>
          <Section title="MEMORY ARCHITECTURE" color={C.accent} defaultOpen>
            <Node label="Brain Files (brain/)" detail="6 files: IDENTITY (sacred), BRAIN (sacred), SOUL (sacred), AGENTS (sacred), MEMORY (auto-updated), HEARTBEAT (auto-updated every 30min). Sacred files are never modified by code." status="sacred" />
            <Node label="Daily Memory Files (brain/memory/)" detail="YYYY-MM-DD.md files generated at 4:30pm ET daily. Contains session logs (last 5 exchanges, message count, cost) + v2.0: trading data (signals generated, trades taken, P&L)." status="active" />
            <Node label="MEMORY.md" detail="Distilled weekly (Sunday 2am ET) by Haiku. Summarizes trading patterns, regime insights, ticker-specific lessons. ~$0.01 per distillation." status="new" />
            <Node label="HEARTBEAT.md" detail="Updated every 30 minutes by orchestrator. Shows: last active time, open positions, signals today, session status." status="new" />
          </Section>

          <Section title="MEMORY PIPELINE EVENTS" subtitle="8 triggers" color={C.cyan}>
            <Step num="①" label="Every Trade Close" detail="trade_outcomes row + ChromaDB trade-learnings vector (lesson text, P&L, ticker, direction)." color={C.green} />
            <Step num="②" label="Every 10 Trades" detail="Pattern summary generated and stored in ChromaDB trade_patterns collection. Captures recurring behaviors." color={C.green} />
            <Step num="③" label="Every 30 Minutes" detail="HEARTBEAT.md auto-updated with current system state: positions, signals, session info." color={C.accent} />
            <Step num="④" label="4:30pm ET Daily" detail="Daily memory file generated (brain/memory/YYYY-MM-DD.md). Captures the day's trading activity." color={C.accent} />
            <Step num="⑤" label="4:15pm ET Weekdays" detail="EOD Review — summarizes the day's performance, posts to #alerts." color={C.warning} />
            <Step num="⑥" label="Sunday 6am UTC" detail="Weekly MEMORY.md distillation — Haiku reads all daily files from the week, distills into updated MEMORY.md." color={C.purple} />
            <Step num="⑦" label="Every Session Start" detail="Brain files loaded into context — IDENTITY, BRAIN, SOUL, AGENTS, MEMORY, HEARTBEAT." color={C.textDim} />
            <Step num="⑧" label="Every Signal" detail="Synthesis Agent queries: training patterns (TrainingBridge) + trade history (v2.0) + KB context (v2.0) + pattern memory (ChromaDB)." color={C.cyan} />
          </Section>

          <Section title="STORAGE LAYERS" color={C.purple}>
            <Node label="SQLite (trevor.db)" detail="15 tables, WAL mode, ~678MB. Primary structured storage for all trades, signals, XP, costs, watchlist, email triage." status="active" />
            <Node label="ChromaDB (chroma_db/)" detail="7+ collections with SentenceTransformer embeddings. Collections: training-* (5), trade-learnings, trade_patterns (v2.0), knowledge_base (v2.0)." status="active" />
            <Node label="Markdown Files (brain/)" detail="6 brain files + daily memory files. Human-readable, git-tracked." status="active" />
          </Section>
        </div>
      )}

      {/* ═══════════ ALL COMMANDS ═══════════ */}
      {activeView === "commands" && (
        <div>
          <Section title="SLASH COMMANDS" subtitle="Discord slash commands" color={C.accent} defaultOpen>
            <Node label="/analyze <ticker>" detail="Run full 4+1 swarm analysis on a ticker. Posts to #research. ~$0.03 per call." />
            <Node label="/scalp" detail="Manual scalp scan — runs DualTrackEngine on all scalp watchlist tickers. Filters NEUTRAL." />
            <Node label="/swing" detail="Manual long-term scan — runs DualTrackEngine on all LT watchlist tickers." />
            <Node label="/watchlist" detail="Show current watchlist with track mode (scalp/lt/both) and asset type." />
            <Node label="/add <ticker> <mode> <type>" detail="Add ticker to watchlist. Modes: scalp, lt, both. Types: stock, crypto, perp." />
            <Node label="/remove <ticker>" detail="Remove ticker from watchlist." />
            <Node label="/portfolio" detail="Show portfolio summary — active trades, total P&L, win rate." />
            <Node label="/performance" detail="Performance metrics — win rate, profit factor, Sharpe estimate, best/worst trades." />
            <Node label="/streak" detail="Show current win/loss streak and recent trade history." />
            <Node label="/mode" detail="Show current trading mode and scan loop status." />
            <Node label="/outcome <ticker> <result> <pnl>" detail="Manual outcome recording — for trades not tracked via signal flow." />
            <Node label="/help" detail="Show all available commands with descriptions." />
            <Node label="/resetxp" detail="Reset XP to 0. Clears xp_ledger." />
          </Section>

          <Section title="TEXT COMMANDS" subtitle="!prefix commands in Discord" color={C.green}>
            <Node label="!kb add <url>" detail="Ingest a URL into the knowledge base. Haiku extracts insights. v2.0." status="new" />
            <Node label="!kb search <query>" detail="Semantic search in knowledge base. Returns top 5 results with sources. v2.0." status="new" />
            <Node label="!kb stats" detail="Show knowledge base statistics — total entries, collection info. v2.0." status="new" />
            <Node label="!research <ticker>" detail="Search KB for research related to a specific ticker. v2.0." status="new" />
            <Node label="!cron" detail="Show orchestrator schedule — all jobs with next run times. v2.0." status="new" />
            <Node label="!quality" detail="Show signal quality report — calibration, ticker perf, overall stats. v2.0." status="new" />
            <Node label="!triage / TRIAGE NOW" detail="Manual email triage trigger. Scans inbox immediately." />
            <Node label="APPROVE DELETE <batch_id>" detail="Approve email deletion batch." />
            <Node label="REJECT <batch_id>" detail="Reject email deletion batch." />
            <Node label="!purge_signals [hours]" detail="Delete bot messages older than N hours from signal channels." />
            <Node label="!purge_trades [hours]" detail="Delete bot messages older than N hours from trade channels." />
          </Section>

          <Section title="XP COMMANDS" subtitle="In #general channel" color={C.yellow}>
            <Node label="reset xp / reset my xp" detail="Reset XP to 0." />
            <Node label="set xp <N>" detail="Set XP to exact value." />
            <Node label="add xp <N>" detail="Add N XP (manual)." />
            <Node label="subtract xp <N>" detail="Subtract N XP (manual). Floor at 0." />
            <Node label="undo last trade" detail="Undo the most recent XP entry — confirmation flow required." />
          </Section>

          <Section title="TRADE REPLY COMMANDS" subtitle="Reply to signal/trade cards" color={C.warning}>
            <Node label="TAKE [leverage]" detail="Take a signal. Default leverage 1.0. Creates live trade card in #active-trades." />
            <Node label="SKIP" detail="Skip a signal. Signal + reply deleted. 0 XP." />
            <Node label="BUILDING" detail="LT equivalent of TAKE. Creates position in #lt-active-trades." />
            <Node label="WATCHING" detail="LT watchlist. No trade created." />
            <Node label="WIN [exit_price]" detail="Close trade as win. 25% price sanity check." />
            <Node label="LOSS [exit_price]" detail="Close trade as loss." />
            <Node label="SCRATCH [exit_price]" detail="Close trade as scratch (+1 XP)." />
          </Section>
        </div>
      )}

      {/* ═══════════ SERVICES & INFRA ═══════════ */}
      {activeView === "services" && (
        <div>
          <Section title="SYSTEMD SERVICES" color={C.accent} defaultOpen>
            <Node label="trevor.service" detail="Main bot — runs /home/trevor/trevor/main.py via venv. User=trevor. Restart=always, RestartSec=10. CRITICAL: Must NOT have StandardOutput/StandardError append directives." status="active" file="trevor.service" />
            <Node label="trevor-dashboard.service" detail="Hub dashboard — Next.js 15 on port 3333. Runs npm start with HOST=0.0.0.0." status="active" file="trevor-dashboard.service" />
            <Node label="trevor-n8n-bridge.service" detail="FastAPI bridge on port 8765 for n8n workflow orchestration." status="active" file="trevor-n8n-bridge.service" />
            <Node label="ghost-qa.service" detail="Ghost QA Agent — separate bot (Ghost#2636), runs as User=ghost. 6 test suites, Haiku grading." status="active" file="ghost-qa.service" />
          </Section>

          <Section title="GCP INFRASTRUCTURE" color={C.info}>
            <Node label="VM: trevor-prime" detail="n1-standard-1, Ubuntu 22.04, us-central1-a. Static IP: 34.28.231.36. Network tags: http-server, trevor." status="active" />
            <Node label="Firewall: trevor-dashboard-web" detail="tcp:3333, 0.0.0.0/0, target-tag: trevor. Allows public access to Hub." status="active" />
            <Node label="GCP Project" detail="project-f2a81435-eff8-44df-a9e. VM has cloud-platform scope for Secret Manager." />
          </Section>

          <Section title="DOCKER SERVICES" color={C.purple}>
            <Node label="n8n" detail="Workflow orchestration platform. 6 workflows: Market Schedule Orchestrator, Discord Router, Trade Event Fanout, Obsidian Vault Writer, EOD Digest, System Health Monitor." status="active" />
            <Node label="nginx" detail="Reverse proxy for n8n container." status="active" />
          </Section>

          <Section title="CRON JOBS" color={C.green}>
            <Node label="Hourly: auto_commit.sh" detail="scripts/auto_commit.sh — git add, commit, push to GitHub every hour." status="active" />
            <Node label="Sunday 6am UTC: run_distillation.sh" detail="Weekly MEMORY.md distillation via memory_pipeline.py." status="new" />
          </Section>

          <Section title="EXTERNAL INTEGRATIONS" color={C.warning}>
            <Node label="Discord" detail="Bot: TREVOR#5383 (discord.py v2.x). 11 channels across 4 categories. Slash commands + text commands." status="active" />
            <Node label="GitHub" detail="ipost76/TREVOR (main branch). SSH remote on VM. Termius deploy: git pull + restart." status="active" />
            <Node label="Anthropic API" detail="Haiku (4 agents) + Sonnet (Synthesis). $0.25/day budget. ~$0.03 per full analysis." status="active" />
            <Node label="Yahoo Finance" detail="Primary market data source (yfinance). Thread-safe with global lock." status="active" />
            <Node label="Yahoo IMAP" detail="ipost76@yahoo.com — email triage agent. Daily scan + manual triggers." status="active" />
            <Node label="Obsidian Vault" detail="~/trevor-vault/ — Trades/, Daily/, Patterns/, Watchlist/, XP/ directories." status="active" />
          </Section>

          <Section title="DISCORD CHANNEL MAP" color={C.cyan}>
            <Node label="🤖 COMMAND" detail="#general — conversation, XP commands, chat | #alerts — briefings, market alerts, system notifications" />
            <Node label="📊 RESEARCH" detail="#research — all research (TA, news, risk, synthesis)" />
            <Node label="📈 TRADING" detail="#scalp-signals — scalp signal posts | #long-term-signals — LT signal posts | #active-trades — scalp trade cards | #lt-active-trades — LT position cards" />
            <Node label="🔧 BUILDING" detail="#dev-logs — system events, errors | #xp-logs — XP awards, rank-ups | #qa-agent — Ghost QA bot | #email-triage — email classification" />
          </Section>
        </div>
      )}
    </div>
  );
}
