import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // Agent decision data is not currently stored in autotrader.db.
  // The swarm agents produce verdicts but individual votes are not persisted.
  // This endpoint returns a stub so the UI can show the "not available" state
  // and will serve real data once agent_votes table is populated.

  const dbPath = "/home/trevor/trevor/autotrader/autotrader.db";

  try {
    const { execSync } = await import("child_process");

    const pyScript = `
import sqlite3, json, os

db = "${dbPath}"
if not os.path.exists(db):
    print(json.dumps({"available": False, "reason": "Database not found"}))
    exit()

conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)

# Check if agent_votes table exists
tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
if "agent_votes" not in tables:
    print(json.dumps({
        "available": False,
        "reason": "Agent decision data is not stored in autotrader.db. Individual swarm agent votes are computed during signal evaluation but not persisted. Recommend adding agent_votes table to capture swarm deliberation for future retrospective analysis.",
        "agents": [],
        "consensus_analysis": None,
    }))
    conn.close()
    exit()

# If table exists, query it
rows = conn.execute("""
    SELECT agent_name, vote, confidence,
           COUNT(*) as total,
           SUM(CASE WHEN vote IN ('LONG','SHORT') THEN 1 ELSE 0 END) as directional
    FROM agent_votes GROUP BY agent_name
""").fetchall()

if not rows:
    print(json.dumps({
        "available": False,
        "reason": "agent_votes table exists but contains no data yet.",
        "agents": [],
        "consensus_analysis": None,
    }))
else:
    agents = []
    for r in rows:
        agents.append({
            "name": r[0],
            "total_votes": r[3],
            "directional_votes": r[4],
        })
    print(json.dumps({"available": True, "agents": agents, "consensus_analysis": None}))

conn.close()
`;

    const pyResult = execSync(
      `/home/trevor/trevor/venv/bin/python3 -c '${pyScript.replace(/'/g, "'\"'\"'")}'`,
      { encoding: "utf-8", timeout: 10000, cwd: "/home/trevor/trevor" }
    ).trim();
    return NextResponse.json(JSON.parse(pyResult));
  } catch (error) {
    console.error("[AutoTrader Agent Analysis] Error:", error);
    return NextResponse.json({
      available: false,
      reason: "Failed to query agent data",
      agents: [],
      consensus_analysis: null,
    });
  }
}
