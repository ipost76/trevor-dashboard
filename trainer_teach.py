#!/usr/bin/env python3
"""trainer_teach.py — the R9 trainer's BOT-BRAIN TEACHING channel [R9-B5, gap T7].

The single WSL-side surface through which the R9 trainer RECOMMENDS how the R5
bot-brain learns to execute better. The trainer writes a NATURAL-LANGUAGE teaching
entry into the `learned-outcomes` ChromaDB collection; the bot recalls it — when
`BOTBRAIN_TEACH_ENABLED` is flipped on — via R5's EXISTING read-only hook
`bot_brain_teach.build_advisory_context`, framed as advisory evidence the LLM
weighs and can OVERRULE.

═══════════════════════════════════════════════════════════════════════════════
 🚨 ADVISORY TEXT, NEVER A WEIGHT (the whole point — do NOT reintroduce a scalar)
═══════════════════════════════════════════════════════════════════════════════
The trainer writes ONLY strings (`documents=[text]`) into the collection. There is
NO path from this module to a numeric weight on the signal path: it never imports
or constructs a `CandidateSignal`, never assigns a `.confidence`, never writes any
scalar the brain must obey. A numeric weight would recreate the torn-out
`SIGNAL_V5_NO_CONFGATE` anti-predictive coupling R4 removed. The bot recalls only
`context_summary` (str) through the sacred bridge; the trainer nudges the
reasoning, it never overwrites the verdict. This is STRUCTURAL, not a convention.

═══════════════════════════════════════════════════════════════════════════════
 🚨 THE ISOLATION LAW (mirror bot_brain_teach._assert_execution_collection)
═══════════════════════════════════════════════════════════════════════════════
The trainer writes into EXACTLY ONE collection — `learned-outcomes` (the sole store
bot_brain_teach names as "the collection R9 writes its teaching into"). It NEVER
writes the synthetic 42%-WR training corpus (`_SYNTHETIC_FORBIDDEN`). Both the
WSL-side dispatch (`_assert_execution_collection`) AND the VM-side program hard-
reject a synthetic / off-allowlist target — architectural, double-guarded.

═══════════════════════════════════════════════════════════════════════════════
 THE WRITE PATH (A1 / RECON-TRAINER-001, §5.6 parity with B2/B4)
═══════════════════════════════════════════════════════════════════════════════
ChromaDB (+ numpy + the `~/trevor/vectordb` corpus) is VM-only — it is NOT
installable/present on the WSL box (the trainer is pure-stdlib by design). So the
"external add path" is the SAME thin ssh pipe B2/B4 established: a base64-embedded
VM-side program run as trevor via
``ssh vm 'cd <bot> && sudo -u trevor venv/bin/python3 -c <loader> <b64_prog> <b64_payload>'``
The VM program opens `chromadb.PersistentClient(~/trevor/vectordb)`,
`get_or_create_collection("learned-outcomes")`, and `.add(documents=[text], ...)`.
This writes ChromaDB DIRECTLY (external of the sacred `training_bridge.py`, which
only READS) and reads flow back through the existing `build_advisory_context`
hook — zero sacred edit. `training_bridge.py` is imported+called nowhere here.

═══════════════════════════════════════════════════════════════════════════════
 GATE — BOTBRAIN_TEACH_ENABLED, checked VM-SIDE, FAIL-CLOSED (ruling A)
═══════════════════════════════════════════════════════════════════════════════
The VM program checks `cfg_bool("BOTBRAIN_TEACH_ENABLED")` (the SAME authoritative
flag `build_advisory_context` gates on) BEFORE any `.add()`. OFF ⇒ NO write lands
⇒ truly inert, provably byte-identical (nothing enters the shared corpus, so the
memory-link feed can never surface an unapproved entry when `BOTBRAIN_MEMORY_LINK_
ENABLED` flips independently). A flag-read failure FAILS CLOSED (skip the write —
never teach what we cannot confirm was approved). Every trainer write is tagged
`metadata={"source": "r9_trainer_teach", ...}` so it is distinguishable from real
closed-trade outcomes in the shared collection.

money_path=no. MAX(level) stays 0. v4 PAUSED. The trainer RECOMMENDS; nothing
trades. Python 3, stdlib only (chromadb/numpy live VM-side).
"""
from __future__ import annotations

import base64
import json
import logging
import os
import shlex
import subprocess
import uuid
from typing import Any, Dict, Optional

# B0 — stdlib-only shared timestamp (keeps every trainer writer uniform).
from lib.trainer_db import utc_now

_log = logging.getLogger("trainer.teach")

# ── The single collection R9 teaches into, and the source tag on every entry ──
TEACH_COLLECTION = "learned-outcomes"
TEACH_SOURCE_TAG = "r9_trainer_teach"

# The read flags the bot gates on (documentation — the gate is enforced VM-side).
BOTBRAIN_TEACH_ENABLED_FLAG = "BOTBRAIN_TEACH_ENABLED"

# ── The isolation law, in code (mirror bot_brain_teach.py:51-78) ──
# Write ONLY into an execution-relevant, real-outcome store. NEVER the synthetic corpus.
_EXECUTION_COLLECTIONS = frozenset({
    "learned-outcomes",             # REAL closed-trade outcomes — R9 teaches HERE
    "training-exit-patterns",
    "training-regime-transitions",
    "trade_knowledge",
    "trade_patterns",
    "winning_setups",
})
_SYNTHETIC_FORBIDDEN = frozenset({
    "training_knowledge",
    "training_observations",
    "training_sentiment",
})

# ── RPC target (env-overridable; defaults to the established `ssh vm` pipe, B2/B4 parity) ──
_VM_HOST = os.environ.get("TRAINER_VM_HOST", "vm")
_VM_DIR = os.environ.get("TRAINER_VM_DIR", "/home/trevor/trevor")
_VM_PY = os.environ.get("TRAINER_VM_PY", "venv/bin/python3")
_DEFAULT_TIMEOUT = float(os.environ.get("TRAINER_RPC_TIMEOUT", "90"))

# The tiny fixed loader (shlex-quoted once): decodes+execs the base64 program in
# argv[1]; the program then decodes the base64 payload in argv[2]. Keeping the
# program + teaching text out of the shell is what makes the payload safe.
_VM_LOADER = (
    "import base64,sys;"
    "exec(compile(base64.b64decode(sys.argv[1]).decode(),'<trainer_teach>','exec'))"
)


def _assert_execution_collection(name: str) -> None:
    """HARD isolation guard (mirror bot_brain_teach._assert_execution_collection).

    Raises on a synthetic / off-allowlist collection so the trainer can never
    colonize the synthetic corpus. The trainer teaches ONLY `learned-outcomes`."""
    if name in _SYNTHETIC_FORBIDDEN:
        raise ValueError(
            f"[TRAINER-TEACH-ISOLATION] refusing to write synthetic corpus {name!r}")
    if name not in _EXECUTION_COLLECTIONS:
        raise ValueError(
            f"[TRAINER-TEACH-ISOLATION] {name!r} is not an execution-relevant collection")
    if name != TEACH_COLLECTION:
        raise ValueError(
            f"[TRAINER-TEACH-ISOLATION] trainer teaches ONLY into {TEACH_COLLECTION!r}, "
            f"got {name!r}")


# ═══════════════════════════════════════════════════════════════════════════════
# THE VM-SIDE PROGRAM (runs as trevor; writes TEXT into learned-outcomes ONLY).
# Carried as a data string so this module's own surface authors no committed VM
# file and cannot itself import chromadb / numpy. It writes ONLY documents=[text]
# — there is no embeddings= / no scalar / no CandidateSignal anywhere in it.
# ═══════════════════════════════════════════════════════════════════════════════
_VM_PROGRAM = r'''
import base64, json, os, sys

def _emit(obj):
    print(json.dumps(obj))
    sys.exit(0)

try:
    payload = json.loads(base64.b64decode(sys.argv[2]).decode())
except Exception as exc:                       # unparseable payload
    _emit({"vm_error": "payload_decode: %s" % exc, "wrote": False})

collection = payload.get("collection") or "learned-outcomes"
vectordb_path = payload.get("vectordb_path") or os.path.expanduser("~/trevor/vectordb")
probe_only = bool(payload.get("probe_only", False))
text = payload.get("text")
metadata = payload.get("metadata") or {}
doc_id = payload.get("doc_id")

# ── ISOLATION LAW (mirror bot_brain_teach._assert_execution_collection) ──
_EXECUTION = {"learned-outcomes", "training-exit-patterns", "training-regime-transitions",
              "trade_knowledge", "trade_patterns", "winning_setups"}
_SYNTHETIC = {"training_knowledge", "training_observations", "training_sentiment"}
if collection in _SYNTHETIC:
    _emit({"vm_error": "isolation: refusing synthetic corpus %r" % collection, "wrote": False})
if collection not in _EXECUTION:
    _emit({"vm_error": "isolation: %r not an execution-relevant collection" % collection, "wrote": False})
if collection != "learned-outcomes":
    _emit({"vm_error": "trainer teaches ONLY into learned-outcomes, got %r" % collection, "wrote": False})

# ── PROBE — read-only reachability (import + get_collection + count). No write, no flag. ──
if probe_only:
    try:
        import chromadb
        client = chromadb.PersistentClient(path=vectordb_path)
        try:
            col = client.get_collection(collection)
            _emit({"probe": True, "chromadb_ok": True, "collection": collection,
                   "count": col.count(), "vectordb_path": vectordb_path})
        except Exception as exc:
            _emit({"probe": True, "chromadb_ok": True, "collection": collection,
                   "collection_missing": True, "detail": str(exc)})
    except Exception as exc:
        _emit({"vm_error": "chromadb_import: %s: %s" % (type(exc).__name__, exc), "wrote": False})

# ── PRODUCTION WRITE — text-only (no numeric weight, no CandidateSignal touched) ──
if not isinstance(text, str) or not text.strip():
    _emit({"vm_error": "no teaching text (text-only writes)", "wrote": False})

# GATE — BOTBRAIN_TEACH_ENABLED, authoritative VM-side, FAIL-CLOSED.
try:
    from auto_trader.config import cfg_bool
    if not cfg_bool("BOTBRAIN_TEACH_ENABLED"):
        _emit({"wrote": False, "skipped": "BOTBRAIN_TEACH_ENABLED off"})
except Exception as exc:
    _emit({"wrote": False, "skipped": "flag_read_error: %s: %s" % (type(exc).__name__, exc),
           "fail_closed": True})

# WRITE — documents=[text] ONLY. The collection's own embedding function embeds the
# text (consistent with how the bot reads it). No embedding arg, no scalar, no signal write.
try:
    import chromadb
    client = chromadb.PersistentClient(path=vectordb_path)
    col = client.get_or_create_collection(collection)
    before = col.count()
    md = {k: v for k, v in dict(metadata).items() if isinstance(v, (str, int, float, bool))}
    md["source"] = "r9_trainer_teach"          # belt-and-suspenders tag (WSL also sets it)
    col.add(documents=[text], metadatas=[md], ids=[doc_id])
    _emit({"wrote": True, "collection": collection, "id": doc_id,
           "count_before": before, "count_after": col.count()})
except Exception as exc:
    _emit({"vm_error": "chromadb_write: %s: %s" % (type(exc).__name__, exc), "wrote": False})
'''


def _vm_call(payload: Dict[str, Any], timeout: float) -> Dict[str, Any]:
    """Run the VM-side teach program over ssh (as trevor); parse its JSON result.

    Never raises to the caller — a transport/parse failure surfaces as an
    ``{"adapter_error": ...}`` dict (never faked into a successful write) so a broken
    pipe can't crash the trainer loop.
    """
    b64_prog = base64.b64encode(_VM_PROGRAM.encode()).decode()
    b64_payload = base64.b64encode(json.dumps(payload).encode()).decode()
    remote = (
        f"cd {shlex.quote(_VM_DIR)} && sudo -u trevor {shlex.quote(_VM_PY)} "
        f"-c {shlex.quote(_VM_LOADER)} {shlex.quote(b64_prog)} {shlex.quote(b64_payload)}"
    )
    try:
        proc = subprocess.run(
            ["ssh", _VM_HOST, remote],
            capture_output=True, text=True, timeout=timeout, check=False,
        )
    except subprocess.TimeoutExpired:
        return {"adapter_error": "rpc_timeout", "wrote": False}
    except Exception as exc:  # ssh missing / OS error
        return {"adapter_error": f"rpc_failed: {exc}", "wrote": False}
    out = (proc.stdout or "").strip()
    if not out:
        return {"adapter_error": f"rpc_no_output (rc={proc.returncode}): "
                f"{(proc.stderr or '').strip()[:400]}", "wrote": False}
    # Take the last non-empty JSON line (skip benign VM-side import chatter on stdout).
    for line in reversed(out.splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue
    return {"adapter_error": f"rpc_unparseable: {out[:400]}", "wrote": False}


def _dispatch_teaching(text: str, metadata: Dict[str, Any], doc_id: str, *,
                       collection: str = TEACH_COLLECTION,
                       timeout: Optional[float] = None) -> Dict[str, Any]:
    """Build the text-only payload and dispatch it VM-side. The WSL-side isolation
    guard runs BEFORE the pipe opens (a synthetic target raises here, no RPC)."""
    _assert_execution_collection(collection)  # hard guard BEFORE any pipe
    payload: Dict[str, Any] = {
        "text": text,
        "metadata": metadata,
        "doc_id": doc_id,
        "collection": collection,
        "vectordb_path": None,   # VM expands ~/trevor/vectordb (the real corpus)
    }
    return _vm_call(payload, float(timeout if timeout is not None else _DEFAULT_TIMEOUT))


def _extract_pattern(learned_pattern: Any) -> Optional[Dict[str, Any]]:
    """Pull the teaching TEXT + scalar metadata off a learned_pattern.

    Accepts a bare string (the teaching text) or a dict carrying ``text`` (or
    ``guidance``/``summary``) plus optional scalar context (ticker/direction/regime/
    level_id + a ``metadata`` sub-dict). Returns None on a malformed/empty pattern
    (caller skips + logs — never fabricates)."""
    if isinstance(learned_pattern, str):
        text = learned_pattern.strip()
        return {"text": text, "metadata": {}} if text else None
    if not isinstance(learned_pattern, dict):
        return None
    raw = (learned_pattern.get("text") or learned_pattern.get("guidance")
           or learned_pattern.get("summary"))
    if not isinstance(raw, str) or not raw.strip():
        return None
    md: Dict[str, Any] = {}
    for key in ("ticker", "direction", "regime", "level_id"):
        val = learned_pattern.get(key)
        if isinstance(val, (str, int, float, bool)):
            md[key] = val
    extra = learned_pattern.get("metadata")
    if isinstance(extra, dict):
        for k, v in extra.items():
            if isinstance(v, (str, int, float, bool)):
                md[str(k)] = v
    return {"text": raw.strip(), "metadata": md}


def recommend_execution_guidance(learned_pattern: Any, *,
                                 timeout: Optional[float] = None) -> None:
    """Recommend how the R5 bot-brain executes better, by writing ONE natural-
    language teaching entry into the `learned-outcomes` collection (advisory text
    the bot recalls via ``build_advisory_context`` when the flag is on — NEVER a
    numeric weight).

    ``learned_pattern`` is a teaching STRING or a dict with ``text`` (+ optional
    scalar ticker/direction/regime/level_id/metadata). Every entry is tagged
    ``source="r9_trainer_teach"``. The write is gated VM-side on
    ``BOTBRAIN_TEACH_ENABLED`` (fail-closed) — OFF ⇒ nothing lands.

    Returns None (side-effecting recommendation). NEVER raises: a malformed pattern
    is skipped+logged; a ChromaDB/transport failure is surfaced in the log, never
    fabricated into a success."""
    parsed = _extract_pattern(learned_pattern)
    if parsed is None:
        _log.warning("[TRAINER-TEACH] skipping malformed learned_pattern (no teaching text)")
        return None

    metadata = dict(parsed["metadata"])
    metadata["source"] = TEACH_SOURCE_TAG          # the distinguishing tag (WSL side)
    metadata.setdefault("ts", utc_now())
    doc_id = f"r9teach-{uuid.uuid4().hex}"

    try:
        result = _dispatch_teaching(parsed["text"], metadata, doc_id, timeout=timeout)
    except ValueError as exc:  # isolation guard tripped (should never happen in prod)
        _log.error("[TRAINER-TEACH] isolation guard refused write: %s", exc)
        return None
    except Exception as exc:  # pragma: no cover - defensive
        _log.warning("[TRAINER-TEACH] dispatch failed: %r", exc)
        return None

    if result.get("wrote"):
        _log.info("[TRAINER-TEACH] taught %s (id=%s, count %s->%s)", TEACH_COLLECTION,
                  doc_id, result.get("count_before"), result.get("count_after"))
    elif result.get("skipped"):
        _log.info("[TRAINER-TEACH] write skipped (inert): %s", result.get("skipped"))
    else:  # adapter_error / vm_error — surfaced, never faked as a success
        _log.warning("[TRAINER-TEACH] write not confirmed: %s",
                     result.get("adapter_error") or result.get("vm_error") or result)
    return None


def probe_chromadb(timeout: Optional[float] = None) -> Dict[str, Any]:
    """Read-only VM-side reachability probe: import chromadb, open the corpus, and
    return the `learned-outcomes` count. Writes NOTHING, needs no flag. Returns the
    VM result dict (or ``{"adapter_error": ...}`` on a transport failure)."""
    payload = {"probe_only": True, "collection": TEACH_COLLECTION, "vectordb_path": None}
    return _vm_call(payload, float(timeout if timeout is not None else _DEFAULT_TIMEOUT))


__all__ = ["recommend_execution_guidance", "probe_chromadb",
           "_assert_execution_collection", "TEACH_COLLECTION", "TEACH_SOURCE_TAG",
           "BOTBRAIN_TEACH_ENABLED_FLAG"]


if __name__ == "__main__":
    # Guarded smoke — NEVER runs on import. Read-only reachability probe (no write,
    # no flag flip); prints whether the VM pipe + ChromaDB + learned-outcomes are
    # reachable. Teaching writes stay inert until BOTBRAIN_TEACH_ENABLED is on.
    logging.basicConfig(level=logging.INFO)
    print(json.dumps({"probe": probe_chromadb()}, indent=2, default=str))
