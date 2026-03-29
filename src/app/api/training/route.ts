import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

export const dynamic = "force-dynamic";

// In-memory cache for training summary (expensive: 15-30s cold, ChromaDB init)
let _summaryCache: { data: unknown; ts: number } | null = null;
const SUMMARY_CACHE_TTL = 300_000; // 5 minutes

/* ── Enrichment helpers (lightweight shell commands) ── */

function getConnectionStatus(execSync: typeof import("child_process").execSync) {
  const result = {
    signal_generation: { wired: true, queries_24h: 0 },
    position_sentinel: { wired: true, queries_24h: 0, threshold_shifts_24h: 0 },
    exit_engine: { wired: true, queries_24h: 0 },
    autotrader: { wired: false, note: "Log-only — does not influence trades" },
    last_training_context: null as string | null,
  };
  try {
    const logFile = "/home/trevor/trevor/logs/trevor.log";
    const signalCount = execSync(
      `grep -c 'TRAINING-V3' ${logFile} 2>/dev/null || echo 0`,
      { timeout: 5000, encoding: "utf-8" }
    ).trim();
    result.signal_generation.queries_24h = parseInt(signalCount) || 0;

    const sentinelCount = execSync(
      `grep -c 'get_full_training_context\\|training v3' ${logFile} 2>/dev/null || echo 0`,
      { timeout: 5000, encoding: "utf-8" }
    ).trim();
    result.position_sentinel.queries_24h = parseInt(sentinelCount) || 0;

    const exitCount = execSync(
      `grep -c 'training_line\\|📚' ${logFile} 2>/dev/null || echo 0`,
      { timeout: 5000, encoding: "utf-8" }
    ).trim();
    result.exit_engine.queries_24h = parseInt(exitCount) || 0;

    const shiftCount = execSync(
      `grep -c 'shifted streak' ${logFile} 2>/dev/null || echo 0`,
      { timeout: 5000, encoding: "utf-8" }
    ).trim();
    result.position_sentinel.threshold_shifts_24h = parseInt(shiftCount) || 0;

    const lastLog = execSync(
      `grep 'TRAINING-V3\\|training v3' ${logFile} 2>/dev/null | tail -1 | head -c 30 || echo ""`,
      { timeout: 5000, encoding: "utf-8" }
    ).trim();
    if (lastLog) result.last_training_context = lastLog;
  } catch { /* safe defaults */ }
  return result;
}

function getVMHealth(execSync: typeof import("child_process").execSync) {
  try {
    const mem = execSync("free -b | grep Mem | awk '{print $2, $3}'", { timeout: 3000, encoding: "utf-8" }).trim().split(" ");
    const disk = execSync("df -B1 /home/trevor | tail -1 | awk '{print $2, $3}'", { timeout: 3000, encoding: "utf-8" }).trim().split(" ");
    return {
      mem_total_gb: Math.round((parseInt(mem[0]) / 1073741824) * 10) / 10,
      mem_used_gb: Math.round((parseInt(mem[1]) / 1073741824) * 10) / 10,
      disk_total_gb: Math.round((parseInt(disk[0]) / 1073741824) * 10) / 10,
      disk_used_gb: Math.round((parseInt(disk[1]) / 1073741824) * 10) / 10,
    };
  } catch { return { mem_total_gb: 0, mem_used_gb: 0, disk_total_gb: 0, disk_used_gb: 0 }; }
}

function getGeneratorStatus(execSync: typeof import("child_process").execSync) {
  const result = { exit_patterns: "complete", regime_transitions: "complete" };
  try {
    const screens = execSync("screen -ls 2>/dev/null || echo ''", { timeout: 3000, encoding: "utf-8" });
    const exitRunning = screens.includes("training_v3_exit");
    const regimeRunning = screens.includes("training_v3_regime");
    const exitCount = execSync(
      'sqlite3 /home/trevor/trevor/trevor.db "SELECT COUNT(*) FROM training_exit_patterns;" 2>/dev/null || echo -1',
      { timeout: 5000, encoding: "utf-8" }
    ).trim();
    const regimeCount = execSync(
      'sqlite3 /home/trevor/trevor/trevor.db "SELECT COUNT(*) FROM training_regime_transitions;" 2>/dev/null || echo -1',
      { timeout: 5000, encoding: "utf-8" }
    ).trim();
    const ep = parseInt(exitCount); const rt = parseInt(regimeCount);
    if (ep === 0 && exitRunning) result.exit_patterns = "generating";
    else if (ep === 0 && !exitRunning) result.exit_patterns = "failed";
    else if (ep < 0) result.exit_patterns = "not_configured";
    if (rt === 0 && regimeRunning) result.regime_transitions = "generating";
    else if (rt === 0 && !regimeRunning) result.regime_transitions = "failed";
    else if (rt < 0) result.regime_transitions = "not_configured";
  } catch { /* safe defaults */ }
  return result;
}

function getNightlyLearnerStatus(execSync: typeof import("child_process").execSync) {
  try {
    const active = execSync(
      'systemctl is-active trevor-nightly-learn.timer 2>/dev/null || echo inactive',
      { timeout: 3000, encoding: "utf-8" }
    ).trim();
    return { timer_active: active === "active" };
  } catch { return { timer_active: false }; }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "summary";
  const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500);
  const offset = parseInt(searchParams.get("offset") || "0");

  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = join(trevorDir, "venv", "bin", "python3");
  const dashboardDir = process.cwd();
  const scriptPath = join(dashboardDir, "query_training.py");

  try {
    const { execSync } = await import("child_process");

    if (scope === "summary") {
      // Return cached summary if fresh (avoids 15-30s Python+ChromaDB cold start)
      if (_summaryCache && Date.now() - _summaryCache.ts < SUMMARY_CACHE_TTL) {
        return NextResponse.json(_summaryCache.data, {
          headers: { "X-Cache": "HIT", "Cache-Control": "private, max-age=300" },
        });
      }
      const raw = execSync(
        `${pythonPath} ${scriptPath} summary`,
        {
          encoding: "utf-8",
          timeout: 90000,
          cwd: trevorDir,
          env: { ...process.env, HOME: "/home/trevor" },
        }
      ).trim();
      const parsed = JSON.parse(raw);
      // Enrich with lightweight shell data
      parsed.connection_status = getConnectionStatus(execSync);
      parsed.vm_health = getVMHealth(execSync);
      parsed.generator_status = getGeneratorStatus(execSync);
      parsed.nightly_learner = getNightlyLearnerStatus(execSync);
      _summaryCache = { data: parsed, ts: Date.now() };
      return NextResponse.json(parsed, {
        headers: { "X-Cache": "MISS", "Cache-Control": "private, max-age=300" },
      });
    }

    if (scope === "records") {
      const filters: Record<string, string> = {};
      const ticker = searchParams.get("ticker");
      const outcome = searchParams.get("outcome");
      const signalType = searchParams.get("signal_type");
      const timeframe = searchParams.get("timeframe");
      const search = searchParams.get("search");
      if (ticker) filters.ticker = ticker;
      if (outcome) filters.outcome = outcome;
      if (signalType) filters.signal_type = signalType;
      if (timeframe) filters.timeframe = timeframe;
      if (search) filters.search = search;

      const filtersJson = JSON.stringify(filters).replace(/'/g, "'\"'\"'");
      const raw = execSync(
        `${pythonPath} ${scriptPath} records ${limit} ${offset} '${filtersJson}'`,
        {
          encoding: "utf-8",
          timeout: 15000,
          cwd: trevorDir,
          env: { ...process.env, HOME: "/home/trevor" },
        }
      ).trim();
      const data = JSON.parse(raw);
      return NextResponse.json({ ...data, limit, offset });
    }

    if (scope === "chroma") {
      const query = searchParams.get("q") || "";
      const collection = searchParams.get("collection") || "training_knowledge";

      if (!query) {
        return NextResponse.json({ results: [], message: "Provide ?q= to search" });
      }

      // Pass query via env var to avoid shell quoting issues
      const raw = execSync(
        `${pythonPath} ${scriptPath} chroma "${query.replace(/"/g, '\\"')}" "${collection}"`,
        {
          encoding: "utf-8",
          timeout: 30000,
          cwd: trevorDir,
          env: { ...process.env, HOME: "/home/trevor" },
        }
      ).trim();
      return NextResponse.json(JSON.parse(raw));
    }

    return NextResponse.json({ error: "Unknown scope. Use ?scope=summary|records|chroma" }, { status: 400 });

  } catch (err) {
    const errMsg = String(err);
    // Return graceful error with scope-appropriate shape
    if (scope === "summary") {
      return NextResponse.json({
        totalRecords: 0, bySource: [], byTable: [], outcomes: {}, winRate: 0, avgConfidence: 0,
        topTickers: [], strategyBreakdown: [], timeframes: [],
        chromaStats: { collections: [], totalDocuments: 0 },
        dateRange: { earliest: null, latest: null }, metadata: {}, distinctTickers: 0,
        rollbackAvailable: false, error: errMsg,
      });
    }
    if (scope === "records") {
      return NextResponse.json({ records: [], total: 0, limit, offset, error: errMsg });
    }
    return NextResponse.json({ results: [], error: errMsg });
  }
}
