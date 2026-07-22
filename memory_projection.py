#!/usr/bin/env python3
"""memory_projection.py — R11-C1 adoption/projection layer (R9 trainer rows → memory.db).

R11 ADOPTS R9's structured reasoning rows in place — their writes DO NOT change. This layer
READS the trainer's ``rejection_log`` + ``standing_hypotheses`` (SELECT-only, read-only
connection) and PROJECTS them into the canonical ``trainer_memory`` shape via the per-agent
``trainer_scope()``. It is the R2 precedent: extend what exists, never build a competitor.

🚨 THE CRITIQUE-LEAK MANDATE (A1's biggest risk):
  There is NO ``project_watcher_critique`` here. ``watcher_critiques`` (the raw per-decision
  critiques of the trainer's OWN arms) is NEVER read into memory.db — projecting it would let
  the trainer read the watcher's critiques of itself through the shared store, breaking Hub-only,
  Ghost-gated teaching. The watcher's GENERALIZED lessons arrive later via B1's native
  ``watcher_scope()`` write (learning, not per-decision critiques). This module imports NO
  watcher module and names NO watcher table — grep-assert the absence.

IDEMPOTENT + PROVENANCE:
  Every projected row carries ``source_db`` / ``source_table`` / ``source_id`` and an
  ``entry_hash`` = sha256(source_db|source_table|source_id|role). memory_db's ``insert_entry``
  does ``INSERT OR IGNORE`` on the UNIQUE(entry_hash) index, so a re-sweep of the same source
  row is a no-op (never duplicates). An incremental CURSOR (in memory_state) advances past the
  highest projected source id so projection is incremental after the bounded backfill.

EMPTY IS EXPECTED: all sources are 0-row pre-cutover. A projection over an empty source (or a
"no such table" on a fresh trainer.db) yields an empty store — never an alarm, never an error.

R11-C1 is NOT a trainer/watcher module (it does not match the ``trainer_*.py`` glob), so it may
legitimately read ``lib.trainer_db`` and write memory — and it touches ``watcher_memory`` NOWHERE.

Python 3, stdlib sqlite3 only.
"""
import hashlib
import json
import sqlite3
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from lib import memory_db, trainer_db
from lib.memory_db import CONFIG_AXES, MECHANICAL_CHECKS, ROLE_HOT

# The reused vocabulary (12 config axes + 5 mechanical-check names) — tags are drawn ONLY
# from this set, never invented.
_VOCAB = frozenset(CONFIG_AXES) | frozenset(MECHANICAL_CHECKS)

# Cursor slots (memory_state keys) — the highest projected source id per source table.
CURSOR_REJECTION = "projection_cursor:rejection_log"
CURSOR_HYPOTHESIS = "projection_cursor:standing_hypotheses"

_SOURCE_DB = "trainer.db"


@dataclass
class Entry:
    """A canonical memory entry produced from an R9 source row (before it is stored)."""
    canonical_id: str
    role: str
    subjects: Dict[str, Any]
    level: int
    action: Optional[str] = None
    because: Optional[str] = None
    outcome: Optional[str] = None
    confidence: Optional[str] = None
    prose: Optional[str] = None
    source_db: Optional[str] = None
    source_table: Optional[str] = None
    source_id: Optional[int] = None
    tags: List[str] = field(default_factory=list)

    @property
    def entry_hash(self) -> str:
        """Deterministic provenance hash — same source row + role ⇒ same hash ⇒ dedup."""
        raw = f"{self.source_db}|{self.source_table}|{self.source_id}|{self.role}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


# ── confidence derivations (documented; exercised on synthetic rows pre-cutover) ──────────
def _confidence_from_rejection(p_value: Optional[float], dsr: Optional[float]) -> str:
    """Strength of a rejection: a small p_value or a negative deflated Sharpe ⇒ high."""
    try:
        if (p_value is not None and float(p_value) < 0.01) or (dsr is not None and float(dsr) < 0.0):
            return "high"
        if p_value is not None and float(p_value) < 0.05:
            return "medium"
    except (TypeError, ValueError):
        pass
    return "low"


def _confidence_from_nobs(n_obs: Optional[int]) -> str:
    """Evidence weight of a hypothesis by observation count (mirrors the store's n thresholds)."""
    try:
        n = int(n_obs or 0)
    except (TypeError, ValueError):
        n = 0
    if n >= 30:
        return "high"
    if n >= 10:
        return "medium"
    return "low"


def _parse_json(raw: Any) -> Any:
    if raw is None or isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


# ── projection functions (A1 §R2 field→tag mapping) ───────────────────────────────────────
def project_trainer_rejection(row: Dict[str, Any]) -> Entry:
    """rejection_log row → canonical Entry.

    subjects {arm_hash, config_json axes} · action 'reject' · because failing_gates + rationale
    · level level_id · outcome 'rejected' · confidence from p_value/dsr · prose rationale_text.
    """
    arm_hash = row.get("arm_hash")
    level_id = int(row.get("level_id") or 0)
    config = _parse_json(row.get("config_json")) or {}
    if not isinstance(config, dict):
        config = {}
    axes = {ax: config[ax] for ax in CONFIG_AXES if ax in config}

    gates = _parse_json(row.get("failing_gates_json")) or []
    gate_names = gates if isinstance(gates, list) else [gates]
    rationale = row.get("rationale_text")
    because_parts = []
    if gate_names:
        because_parts.append("failing_gates=" + ", ".join(str(g) for g in gate_names))
    if rationale:
        because_parts.append(str(rationale))
    because = " | ".join(because_parts) if because_parts else None

    return Entry(
        canonical_id=f"trainer:reject:{arm_hash}:{level_id}",
        role=ROLE_HOT,
        subjects={"arm_hash": arm_hash, "config": axes},
        level=level_id,
        action="reject",
        because=because,
        outcome="rejected",
        confidence=_confidence_from_rejection(row.get("p_value"), row.get("dsr")),
        prose=rationale,
        source_db=_SOURCE_DB,
        source_table="rejection_log",
        source_id=(None if row.get("id") is None else int(row["id"])),
        # tags ONLY from the reused vocabulary — the config axes actually present
        tags=[ax for ax in CONFIG_AXES if ax in axes],
    )


def project_trainer_hypothesis(row: Dict[str, Any]) -> Entry:
    """standing_hypotheses row → canonical Entry.

    subjects {domain, hypothesis_id} · action 'hypothesize' · because claim · level level_id
    · outcome status · confidence from n_obs · prose claim + evidence summary.
    """
    domain = row.get("domain")
    hyp_id = row.get("hypothesis_id")
    level_id = int(row.get("level_id") or 0)
    claim = row.get("claim")
    evidence = _parse_json(row.get("evidence_json"))
    ev_summary = ""
    if isinstance(evidence, dict) and evidence:
        ev_summary = " | evidence: " + ", ".join(f"{k}={evidence[k]}" for k in sorted(evidence))
    prose = f"{claim or ''}{ev_summary}".strip() or None

    return Entry(
        canonical_id=f"trainer:hypothesis:{hyp_id}:{level_id}",
        role=ROLE_HOT,
        subjects={"domain": domain, "hypothesis_id": hyp_id},
        level=level_id,
        action="hypothesize",
        because=(str(claim) if claim else None),
        outcome=row.get("status"),
        confidence=_confidence_from_nobs(row.get("n_obs")),
        prose=prose,
        source_db=_SOURCE_DB,
        source_table="standing_hypotheses",
        source_id=(None if row.get("rowid") is None else int(row["rowid"])),
        # tag the domain ONLY if it is within the reused vocabulary (never invent a tag)
        tags=[str(domain)] if domain in _VOCAB else [],
    )


# ── read (SELECT-only, read-only connection) + store + incremental cursor ──────────────────
def _open_source_ro() -> Optional[sqlite3.Connection]:
    """Open trainer.db STRICTLY read-only (mode=ro) so R9's writes are provably unchanged.

    Returns None if the trainer db file cannot be opened at all (treated as empty source).
    """
    path = trainer_db.resolve_db_path()
    try:
        return sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.Error:
        return None  # no source yet -> empty projection


def _store(scope: "memory_db.MemoryScope", entry: Entry, *, commit: bool = True) -> int:
    """Insert one Entry via the trainer scope (INSERT OR IGNORE on entry_hash) + tag it."""
    entry_id = scope.insert_entry(
        canonical_id=entry.canonical_id, role=entry.role, subjects=entry.subjects,
        level=entry.level, action=entry.action, because=entry.because,
        outcome=entry.outcome, confidence=entry.confidence, prose=entry.prose,
        source_db=entry.source_db, source_table=entry.source_table,
        source_id=entry.source_id, entry_hash=entry.entry_hash, commit=commit,
    )
    existing = set(scope.tags_for(entry_id))
    for tag in entry.tags:
        if tag not in existing:  # idempotent: don't re-tag a re-projected row
            scope.tag(entry_id, tag, commit=commit)
    return entry_id


def _sweep_table(src: sqlite3.Connection, scope: "memory_db.MemoryScope", *,
                 table: str, cursor_key: str, id_col: str, projector) -> int:
    """Project new rows past the stored cursor. 'no such table' / 0 rows -> 0 (expected empty)."""
    raw = memory_db.get_state(cursor_key, conn=scope.conn)
    try:
        cursor = int(raw) if raw is not None else 0
    except (TypeError, ValueError):
        cursor = 0
    try:
        src.row_factory = sqlite3.Row
        rows = src.execute(
            f"SELECT rowid AS rowid, * FROM {table} WHERE {id_col} > ? ORDER BY {id_col}",
            (cursor,),
        ).fetchall()
    except sqlite3.OperationalError:
        return 0  # table absent on a fresh trainer.db — expected pre-cutover, never an alarm
    n = 0
    max_seen = cursor
    for r in rows:
        d = dict(r)
        entry = projector(d)
        _store(scope, entry, commit=False)
        sid = d.get(id_col)
        if sid is not None:
            max_seen = max(max_seen, int(sid))
        n += 1
    if n:
        memory_db.upsert_state(cursor_key, str(max_seen), conn=scope.conn)
        scope.conn.commit()
    return n


def run_projection(db_path: Optional[str] = None) -> Dict[str, int]:
    """Backfill + incremental sweep of BOTH trainer sources into trainer_memory.

    Returns ``{"rejection_log": n, "standing_hypotheses": m}`` (0/0 over an empty source — the
    expected pre-cutover state, never an error). NO watcher critique is read. The cursor lives
    in memory_state, so re-running only projects rows newer than the last sweep.
    """
    src = _open_source_ro()
    scope = memory_db.trainer_scope(db_path)
    try:
        if src is None:
            return {"rejection_log": 0, "standing_hypotheses": 0}
        n_rej = _sweep_table(src, scope, table="rejection_log",
                             cursor_key=CURSOR_REJECTION, id_col="id",
                             projector=project_trainer_rejection)
        n_hyp = _sweep_table(src, scope, table="standing_hypotheses",
                             cursor_key=CURSOR_HYPOTHESIS, id_col="rowid",
                             projector=project_trainer_hypothesis)
        return {"rejection_log": n_rej, "standing_hypotheses": n_hyp}
    finally:
        scope.close()
        if src is not None:
            src.close()


# 🚨 NO project_watcher_critique — watcher_critiques is NEVER read into memory.db (leak mandate).


if __name__ == "__main__":
    # Smoke only — guarded, NEVER runs on import. Over the empty pre-cutover source this
    # prints {'rejection_log': 0, 'standing_hypotheses': 0} — the EXPECTED empty result.
    print(run_projection())
