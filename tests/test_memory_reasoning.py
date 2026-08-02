#!/usr/bin/env python3
"""Tests for R11-B3 — the queryable reasoning log (M6) + the watcher memory namespace (M9).

Runnable directly (stdlib only, no pytest): ``python3 tests/test_memory_reasoning.py``.

Proves, over SYNTHETIC adopted rows in isolated temp DBs (MEMORY_DB_PATH / TRAINER_DB_PATH):
  * the reasoning trail returns "considered X → rejected because Y, at level N" with the fired
    gates + rationale text PRESENT (the WHY preserved, never a bare outcome);
  * standing-hypothesis accumulation is exposed as ONE ROW PER LEVEL — NOT flattened;
  * malformed JSON in a source field is skipped + counted, never a crash;
  * an empty source yields an empty trail, never an error;
  * write_watcher_lesson writes a GENERALIZED lesson to watcher_memory (untagged → raise),
    is idempotent, and REFUSES a per-decision critique (decision_ref/arm_hash subjects) +
    off-vocabulary tags — the critique-leak boundary encoded in the signature;
  * memory_reasoning NEVER reads watcher_critiques / never opens watcher.db (AST scan);
  * a trainer-scoped handle still cannot reach watcher_memory;
  * flag OFF ⇒ every public fn is inert (empty reads, no-op writes).
"""
import ast
import atexit
import os
import shutil
import sqlite3
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
if _REPO not in sys.path:
    sys.path.insert(0, _REPO)

# ── MODULE-LEVEL store protection (B11) ───────────────────────────────────────
# 🚨 `main()` below already points MEMORY_DB_PATH / TRAINER_DB_PATH at temp dbs — but
# only once main() RUNS. Until B11 this file had NO protection above that point, so a
# new test function added ahead of main()'s setup (or any import-time store call) would
# reach the live data/*.db and nothing would say so. Ordering is not a safety mechanism.
# This sets scratch defaults at import; main() still overrides them with its own dirs.
_B11_SCRATCH = tempfile.mkdtemp(
    prefix="r11b3_module_", dir="/home/ghost/tmp" if os.path.isdir("/home/ghost/tmp") else None
)
os.environ["MEMORY_DB_PATH"] = os.path.join(_B11_SCRATCH, "memory.db")
os.environ["TRAINER_DB_PATH"] = os.path.join(_B11_SCRATCH, "trainer.db")
atexit.register(shutil.rmtree, _B11_SCRATCH, True)

_PASS = 0
_FAIL = 0


def check(name, cond, detail=""):
    global _PASS, _FAIL
    if cond:
        _PASS += 1
        print(f"  ✓ {name}")
    else:
        _FAIL += 1
        print(f"  ✗ {name}  {detail}")


def raises(fn, exc=ValueError):
    try:
        fn()
        return False
    except exc:
        return True


# ── trainer.db source schema (verbatim from the live schema) ────────────────────────────────────
_REJECTION_DDL = """
CREATE TABLE rejection_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arm_hash TEXT NOT NULL, level_id INTEGER NOT NULL, config_json TEXT NOT NULL,
  failing_gates_json TEXT, rationale_text TEXT,
  p_value REAL, dsr REAL, ts TEXT NOT NULL
)
"""
_HYPOTHESIS_DDL = """
CREATE TABLE standing_hypotheses (
  hypothesis_id TEXT NOT NULL, level_id INTEGER NOT NULL,
  domain TEXT NOT NULL, claim TEXT NOT NULL,
  evidence_json TEXT, n_obs INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open', last_updated TEXT NOT NULL,
  PRIMARY KEY (hypothesis_id, level_id)
)
"""


def _seed_trainer_db(path):
    c = sqlite3.connect(path)
    c.execute(_REJECTION_DDL)
    c.execute(_HYPOTHESIS_DDL)
    # rejection A — well-formed, the WHY = fired gates + rationale + raw p/dsr evidence
    c.execute(
        "INSERT INTO rejection_log (arm_hash, level_id, config_json, failing_gates_json, "
        "rationale_text, p_value, dsr, ts) VALUES (?,?,?,?,?,?,?,?)",
        ("armAAA", 3, '{"tickers":["BTC"],"leverage":5}', '["drawdown_wall","cvar_wall"]',
         "rejected: drawdown exceeded the survival wall", 0.002, -0.4, "2026-07-22T00:00:00Z"),
    )
    # rejection B — MALFORMED failing_gates_json (the skip+count vector); rationale still preserved
    c.execute(
        "INSERT INTO rejection_log (arm_hash, level_id, config_json, failing_gates_json, "
        "rationale_text, p_value, dsr, ts) VALUES (?,?,?,?,?,?,?,?)",
        ("armBBB", 3, '{"size":0.1}', '{bad json', "rejected: cost bar not cleared",
         0.03, 0.1, "2026-07-22T00:01:00Z"),
    )
    # hypothesis hyp1 accumulating across levels 1 → 2 (composite PK; must NOT flatten)
    c.execute(
        "INSERT INTO standing_hypotheses (hypothesis_id, level_id, domain, claim, evidence_json, "
        "n_obs, status, last_updated) VALUES (?,?,?,?,?,?,?,?)",
        ("hyp1", 1, "cost", "taker fees dominate net edge",
         '{"delta":-0.2,"direction":"against","n_obs":12}', 12, "open", "2026-07-22T00:02:00Z"),
    )
    c.execute(
        "INSERT INTO standing_hypotheses (hypothesis_id, level_id, domain, claim, evidence_json, "
        "n_obs, status, last_updated) VALUES (?,?,?,?,?,?,?,?)",
        ("hyp1", 2, "cost", "taker fees dominate net edge",
         '{"delta":-0.35,"direction":"against","n_obs":40}', 40, "supported", "2026-07-22T00:03:00Z"),
    )
    c.commit()
    c.close()


def main():
    tmp = tempfile.mkdtemp(prefix="r11b3_")
    mem_db = os.path.join(tmp, "memory.db")
    trn_db = os.path.join(tmp, "trainer.db")
    os.environ["MEMORY_DB_PATH"] = mem_db
    os.environ["TRAINER_DB_PATH"] = trn_db
    os.environ["MEMORY_REASONING_ENABLED"] = "1"

    import memory_reasoning as mr
    from lib import memory_db

    print("=== R11-B3 reasoning log + watcher memory (M6 + M9) ===")

    # ── (0) EMPTY SOURCE → EMPTY TRAIL (pre-cutover EXPECTED) ──
    check("empty source → empty reasoning_trail, no error", mr.reasoning_trail() == [])
    check("empty source → empty hypothesis_trail, no error", mr.hypothesis_trail("hyp1") == [])

    # ── adopt synthetic source rows via C1's projection ──
    _seed_trainer_db(trn_db)
    adopted = mr.refresh_reasoning_log()
    check("refresh_reasoning_log adopted 2 rejections + 2 hypotheses",
          adopted == {"rejection_log": 2, "standing_hypotheses": 2}, str(adopted))

    # ── (1) reasoning trail: considered X → rejected because Y → at level N ──
    steps, stats = mr.reasoning_trail(return_stats=True)
    check("trail has all 4 adopted steps (2 reject + 2 hypothesize)", len(steps) == 4, str(len(steps)))

    a = mr.reasoning_trail(arm_hash="armAAA")
    check("arm_hash filter → exactly the armAAA rejection", len(a) == 1, str(len(a)))
    step = a[0] if a else {}
    check("  kind = reject", step.get("kind") == "reject")
    check("  level = 3 (at which level N)", step.get("level") == 3)
    check("  subjects carry what was CONSIDERED (arm_hash armAAA)",
          isinstance(step.get("subjects"), dict) and step["subjects"].get("arm_hash") == "armAAA")

    # ── (2) THE WHY IS PRESERVED — because carries fired gates + rationale, not a bare outcome ──
    because = step.get("because") or ""
    check("  because carries the fired GATE NAMES", "drawdown_wall" in because and "cvar_wall" in because, because)
    check("  because carries the RATIONALE TEXT", "survival wall" in because, because)
    check("  because is NOT a bare outcome label", because.strip() not in ("rejected", "reject", ""))
    check("  structured failing_gates present from source", step.get("failing_gates") == ["drawdown_wall", "cvar_wall"],
          str(step.get("failing_gates")))
    ev = step.get("evidence") or {}
    check("  raw statistical evidence surfaced (p_value/dsr)", ev.get("p_value") == 0.002 and ev.get("dsr") == -0.4, str(ev))

    # tag filter uses the SHARED memory_tags index (the same index B1's have_we_tested uses)
    check("tag='leverage' → armAAA (config axis tag)",
          [s["subjects"].get("arm_hash") for s in mr.reasoning_trail(tag="leverage")] == ["armAAA"])
    check("tag='size' → armBBB (config axis tag)",
          [s["subjects"].get("arm_hash") for s in mr.reasoning_trail(tag="size")] == ["armBBB"])
    check("action='hypothesize' filter → the 2 hypothesis steps",
          len(mr.reasoning_trail(action="hypothesize")) == 2)

    # ── (3) STANDING-HYPOTHESIS ACCUMULATION — one row per level, NOT flattened ──
    ht = mr.hypothesis_trail("hyp1")
    check("hypothesis_trail returns 2 rows for 2 levels (accumulation, not flattened)", len(ht) == 2, str(len(ht)))
    check("  levels in order [1, 2]", [s["level"] for s in ht] == [1, 2], str([s["level"] for s in ht]))
    nobs = [(s.get("evidence") or {}).get("n_obs") for s in ht]
    check("  per-level evidence distinct + preserved (n_obs 12 → 40)", nobs == [12, 40], str(nobs))
    statuses = [(s.get("evidence") or {}).get("status") for s in ht]
    check("  per-level status preserved (open → supported)", statuses == ["open", "supported"], str(statuses))
    check("  the claim (WHY) is present on each level", all("taker fees" in (s.get("because") or "") for s in ht))

    # ── (4) MALFORMED JSON in a source field → skipped + counted, never a crash ──
    check("malformed source failing_gates_json counted (source_evidence_errors ≥ 1)",
          stats["source_evidence_errors"] >= 1, str(stats))
    b = mr.reasoning_trail(arm_hash="armBBB")
    check("  malformed step STILL returned (not dropped)", len(b) == 1, str(len(b)))
    check("  malformed gates → empty list, no crash", b and b[0].get("failing_gates") == [])
    check("  malformed step's rationale (WHY) still preserved", b and "cost bar" in (b[0].get("because") or ""))
    check("  no malformed adopted rows skipped (projection guarantees valid subjects)",
          stats["skipped_malformed"] == 0, str(stats))

    # ── (5) NO DUPLICATION OF B1 — B3 shares memory_tags, does not re-implement a verdict lookup ──
    check("no 'have_we_tested' symbol defined in B3 (B1 owns it)", not hasattr(mr, "have_we_tested"))
    check("B3 imports no B1 module at load (only memory_db / memory_projection / trainer_db-local)",
          "memory_query" not in sys.modules)

    # ═══ PHASE 2 — watcher memory namespace (M9) ═══
    # ── (6) write_watcher_lesson writes a GENERALIZED lesson via watcher_scope ──
    lesson = dict(
        subjects={"oversight_area": "skipped_gate detection", "regime": "at this level"},
        action="observe", because="mechanical checks reliably catch skipped gates",
        level=3, tags=["skipped_gate"], outcome="note", confidence="mechanical",
        prose="At level 3 the skipped_gate check fired on every genuinely-skipped rejection.",
    )
    lid = mr.write_watcher_lesson(**lesson)
    check("write_watcher_lesson returns an id", isinstance(lid, int) and lid > 0, str(lid))
    ws = memory_db.watcher_scope()
    try:
        check("  lesson landed in watcher_memory", ws.count() == 1, str(ws.count()))
        row = ws.get_entry(lid)
        check("  row action/because preserved", row and row["action"] == "observe" and "skipped gates" in (row["because"] or ""))
        check("  tag enforced + stored", ws.tags_for(lid) == ["skipped_gate"], str(ws.tags_for(lid)))
    finally:
        ws.close()
    check("  tier pointer set to HOT", memory_db.get_tier("watcher:lesson:" + __import__("hashlib").sha256(
        (__import__("json").dumps(lesson["subjects"], sort_keys=True) + "|observe|3").encode()).hexdigest()[:24]) == memory_db.ROLE_HOT)

    # ── untagged → raise ──
    check("untagged lesson → raises", raises(lambda: mr.write_watcher_lesson(
        subjects={"oversight_area": "x"}, action="observe", because="y", level=1, tags=[]), ValueError))
    check("off-vocabulary tag → raises", raises(lambda: mr.write_watcher_lesson(
        subjects={"oversight_area": "x"}, action="observe", because="y", level=1, tags=["not_a_real_axis"]), ValueError))

    # ── idempotency: same lesson twice → one row ──
    lid2 = mr.write_watcher_lesson(**lesson)
    ws = memory_db.watcher_scope()
    try:
        check("idempotent: same lesson twice → one row (same id)", lid2 == lid and ws.count() == 1, f"{lid2}/{ws.count()}")
    finally:
        ws.close()

    # ── (7) 🚨 GENERALIZED-ONLY — a per-decision critique is REFUSED structurally ──
    check("subjects with decision_ref → REFUSED (per-decision critique)", raises(lambda: mr.write_watcher_lesson(
        subjects={"decision_ref": "ref:99"}, action="observe", because="arm was rash", level=3,
        tags=["skipped_gate"]), ValueError))
    check("subjects with arm_hash → REFUSED (per-decision critique)", raises(lambda: mr.write_watcher_lesson(
        subjects={"arm_hash": "abc123"}, action="observe", because="arm was rash", level=3,
        tags=["skipped_gate"]), ValueError))
    check("subjects with critique key → REFUSED", raises(lambda: mr.write_watcher_lesson(
        subjects={"critique": "abc"}, action="observe", because="x", level=3, tags=["skipped_gate"]), ValueError))
    check("write_watcher_lesson exposes NO decision_ref parameter",
          "decision_ref" not in mr.write_watcher_lesson.__code__.co_varnames)

    # ── (8) B3 NEVER reads watcher_critiques / never opens watcher.db (AST scan, ignores docstrings/comments) ──
    src = open(os.path.join(_REPO, "memory_reasoning.py"), "r", encoding="utf-8").read()
    tree = ast.parse(src)
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", [])
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                docstrings.add(id(body[0].value))
    forbidden = ("watcher_critiques", "watcher.db", "watcher_integrity")
    code_tokens = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
            code_tokens.append(node.value)
        elif isinstance(node, ast.Name):
            code_tokens.append(node.id)
        elif isinstance(node, ast.Attribute):
            code_tokens.append(node.attr)
        elif isinstance(node, ast.alias):
            code_tokens.append(node.name)
            if node.asname:
                code_tokens.append(node.asname)
    # 'watcher_db' as a bare code identifier (the critique-store module) is forbidden; the legit
    # 'watcher_scope' / 'watcher_memory' accessor+namespace are allowed and NOT in `forbidden`.
    leaks = [t for t in code_tokens if any(f in t for f in forbidden) or t == "watcher_db"]
    check("AST: no watcher_critiques / watcher.db / watcher_db / watcher_integrity in CODE", leaks == [], str(leaks))
    # and a direct grep sanity: the ONLY occurrences of these tokens are prose (docstring/comments)
    import subprocess
    grep = subprocess.run(["grep", "-nE", r"watcher_critiques|watcher\.db|watcher_integrity",
                           os.path.join(_REPO, "memory_reasoning.py")], capture_output=True, text=True)
    hits = [ln for ln in grep.stdout.splitlines() if ln.strip()]
    only_prose = all(("#" in ln.split(":", 2)[-1]) or ln.split(":", 2)[-1].lstrip().startswith(("*", '"', "'", "watcher_critiques`", "``"))
                     or "🚨" in ln or "Hub-only" in ln or "watcher.db``" in ln or "never opens" in ln or "NEVER" in ln
                     for ln in hits) if hits else True
    check("grep: watcher_critiques / watcher.db appear ONLY in prose (docstring/comments)", only_prose, str(hits[:2]))

    # ── (9) trainer-scoped handle still cannot reach watcher_memory ──
    ts = memory_db.trainer_scope()
    ws = memory_db.watcher_scope()
    try:
        check("trainer scope bound to trainer_memory ONLY", ts._table == "trainer_memory", ts._table)
        check("watcher scope bound to watcher_memory ONLY", ws._table == "watcher_memory", ws._table)
        before_t, before_w = ts.count(), ws.count()
        # a trainer write lands in trainer_memory; watcher_memory is untouched by it
        ts.insert_entry(canonical_id="trainer:probe:1", role=memory_db.ROLE_HOT,
                        subjects={"probe": 1}, level=0, action="probe", entry_hash="probe_hash_r11b3")
        check("trainer write → trainer_memory grows, watcher_memory UNCHANGED",
              ts.count() == before_t + 1 and ws.count() == before_w, f"t={ts.count()} w={ws.count()}")
    finally:
        ts.close()
        ws.close()

    # ── (10) FLAG OFF ⇒ fully inert (empty reads, no-op writes) ──
    os.environ["MEMORY_REASONING_ENABLED"] = "false"
    ws = memory_db.watcher_scope()
    try:
        w_before = ws.count()
    finally:
        ws.close()
    check("flag OFF → reasoning_trail empty", mr.reasoning_trail() == [])
    check("flag OFF → hypothesis_trail empty", mr.hypothesis_trail("hyp1") == [])
    check("flag OFF → refresh is inert (no adoption)", mr.refresh_reasoning_log() == {"rejection_log": 0, "standing_hypotheses": 0})
    off_id = mr.write_watcher_lesson(subjects={"oversight_area": "z"}, action="observe",
                                     because="z", level=1, tags=["skipped_gate"])
    ws = memory_db.watcher_scope()
    try:
        check("flag OFF → write_watcher_lesson no-op (returns 0, no row)", off_id == 0 and ws.count() == w_before, f"{off_id}/{ws.count()}")
    finally:
        ws.close()
    os.environ["MEMORY_REASONING_ENABLED"] = "1"

    print(f"=== {_PASS}/{_PASS + _FAIL} PASS ===")
    return 0 if _FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
