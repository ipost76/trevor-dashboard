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
import logging
import sqlite3
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from lib import memory_db, trainer_db
from lib.memory_db import CONFIG_AXES, MECHANICAL_CHECKS, ROLE_HOT

# The reused vocabulary (12 config axes + 5 mechanical-check names) — tags are drawn ONLY
# from this set, never invented.
_VOCAB = frozenset(CONFIG_AXES) | frozenset(MECHANICAL_CHECKS)

# Cursor slots (memory_state keys). rejection_log advances on the INSERT-only integer ``id``;
# standing_hypotheses advances on ``last_updated`` (a monotonic ISO string) because it UPSERTs
# in place — the rowid never moves (W10). The value stored is the highest cursor seen.
CURSOR_REJECTION = "projection_cursor:rejection_log"
CURSOR_HYPOTHESIS = "projection_cursor:standing_hypotheses"

_SOURCE_DB = "trainer.db"
_log = logging.getLogger(__name__)


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
    # W10: an optional CONTENT signature folded into entry_hash for sources that UPDATE a row
    # in place (standing_hypotheses UPSERTs on (hyp_id, level_id); its rowid never moves).
    # None (rejection_log — INSERT-only, id-based) ⇒ the hash is byte-identical to pre-W10.
    content_key: Optional[str] = None
    tags: List[str] = field(default_factory=list)

    @property
    def entry_hash(self) -> str:
        """Deterministic provenance hash — same source row + role ⇒ same hash ⇒ dedup.

        🚨 W10: without a content component, an UPSERT-in-place source (standing_hypotheses)
        re-hashes IDENTICALLY as evidence grows → INSERT OR IGNORE dedups it → within-level
        accumulation freezes at first-seen. ``content_key`` (set only by the hypothesis
        projector, to ``n_obs|last_updated``) makes an updated row hash DIFFERENTLY so a new
        append-only row lands. ``content_key=None`` ⇒ raw is byte-identical to the pre-W10
        ``db|table|id|role`` scheme (the rejection half is left exactly as it was).
        """
        raw = f"{self.source_db}|{self.source_table}|{self.source_id}|{self.role}"
        if self.content_key is not None:
            raw += f"|{self.content_key}"
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


def _coerce_level(raw: Any, table: str, ref: Any) -> Optional[int]:
    """🚨 BLOCK-2 fail-loud guard: a projected level MUST be a positive int. A missing / <1
    level → SKIP the row + a LOUD warning, NEVER a silent level-0 projection (which would
    poison compute_tier demotion latently — the exact latent-until-L3 class BLOCK-2 was).
    Harmless today (log_rejection/_level_of raise on level-less input); a tripwire, not a
    default. Skip-and-count matches memory_reasoning's 'one bad source row is not fatal'."""
    try:
        lvl = int(raw)
    except (TypeError, ValueError):
        _log.warning("memory_projection: %s row (ref=%r) has non-int level_id=%r — SKIPPED "
                     "(refuse a silent level-0 projection)", table, ref, raw)
        return None
    if lvl < 1:
        _log.warning("memory_projection: %s row (ref=%r) has level_id=%d (<1) — SKIPPED "
                     "(refuse a silent level-0 projection)", table, ref, lvl)
        return None
    return lvl


# ── projection functions (A1 §R2 field→tag mapping) ───────────────────────────────────────
def project_trainer_rejection(row: Dict[str, Any]) -> Optional[Entry]:
    """rejection_log row → canonical Entry (or None to SKIP a level<1 row, W4-tighten).

    subjects {arm_hash, config_json axes} · action 'reject' · because failing_gates + rationale
    · level level_id · outcome 'rejected' · confidence from p_value/dsr · prose rationale_text.
    """
    arm_hash = row.get("arm_hash")
    level_id = _coerce_level(row.get("level_id"), "rejection_log", arm_hash)
    if level_id is None:
        return None  # refuse a silent level-0 projection (was ``int(... or 0)``)
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


def project_trainer_hypothesis(row: Dict[str, Any]) -> Optional[Entry]:
    """standing_hypotheses row → canonical Entry (or None to SKIP a level<1 row, W4-tighten).

    subjects {domain, hypothesis_id} · action 'hypothesize' · because claim · level level_id
    · outcome status · confidence from n_obs · prose claim + evidence summary.

    🚨 W10: ``content_key = n_obs|last_updated`` makes entry_hash content-aware so a within-
    level re-eval (UPSERT-in-place, growing n_obs) lands a NEW append-only row instead of
    being deduped by INSERT OR IGNORE. ``source_id`` stays the (stable) rowid for provenance;
    the CURSOR moves to ``last_updated`` in ``_sweep_table`` (the rowid never advances).
    """
    domain = row.get("domain")
    hyp_id = row.get("hypothesis_id")
    level_id = _coerce_level(row.get("level_id"), "standing_hypotheses", hyp_id)
    if level_id is None:
        return None  # refuse a silent level-0 projection (was ``int(... or 0)``)
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
        # W10: fold the within-level growth signal into the hash (see entry_hash + docstring).
        content_key=f"{row.get('n_obs')}|{row.get('last_updated')}",
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
                 table: str, cursor_key: str, id_col: str, projector,
                 cursor_is_text: bool = False) -> int:
    """Project new rows past the stored cursor. 'no such table' / 0 rows -> 0 (expected empty).

    🚨 W10: ``cursor_is_text`` selects a STRING cursor. standing_hypotheses sweeps on
    ``last_updated`` (a monotonic ISO timestamp) because ``evaluate_at_level`` UPSERTs in
    place — the rowid never advances, so a ``rowid > cursor`` sweep would never re-select an
    updated row. The rejection sweep keeps the integer ``id`` cursor (``cursor_is_text=False``,
    the default) → byte-identical to pre-W10. ``>`` (not ``>=``) is safe: ``last_updated`` is
    set from ``utc_now()`` on every UPSERT and strictly increases across evaluations (each is a
    full loop iteration seconds+ apart); a same-second re-eval of the SAME (hyp, level) — the
    only case ``>`` could miss — cannot happen in the loop. (Defense-in-depth: content_key
    also folds n_obs, so two distinct-n_obs rows swept in ONE pass both land.)

    A projector may return None to SKIP a row (e.g. the level<1 guard). The cursor still
    advances past a skipped row (logged once by the projector, never re-swept), matching the
    'one bad source row is counted, not fatal' posture.
    """
    raw = memory_db.get_state(cursor_key, conn=scope.conn)
    if cursor_is_text:
        cursor: Any = raw if raw is not None else ""
    else:
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
    n = 0            # rows actually projected (returned to the caller)
    swept = 0        # rows seen this pass (gates the cursor advance — skipped rows count here)
    max_seen = cursor
    for r in rows:
        d = dict(r)
        sid = d.get(id_col)
        if sid is not None:
            max_seen = max(max_seen, str(sid)) if cursor_is_text else max(max_seen, int(sid))
        swept += 1
        entry = projector(d)
        if entry is None:
            continue  # skipped (e.g. level<1) — cursor still advances past it, logged once
        _store(scope, entry, commit=False)
        n += 1
    if swept:
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
                             cursor_key=CURSOR_HYPOTHESIS, id_col="last_updated",
                             projector=project_trainer_hypothesis, cursor_is_text=True)
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
