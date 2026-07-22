#!/usr/bin/env python3
"""Tests for the R9-B5 bot-brain teaching channel (trainer_teach.py).

Proves the load-bearing invariants:
  * ANTI-WEIGHT (structural): the module writes only TEXT — it has ZERO code
    reference to `CandidateSignal` / `setattr`, the VM program writes
    `documents=[text]` and NEVER `embeddings=`/a scalar, and a captured payload
    carries only string documents + scalar metadata (no numeric-weight key).
  * ISOLATION (architectural): `_assert_execution_collection` HARD-raises on each
    of the 3 synthetic-forbidden collections + an off-allowlist name, and a
    dispatch to a synthetic target raises BEFORE the pipe opens (no RPC).
  * The trainer writes a TEXT entry into `learned-outcomes` tagged
    `source="r9_trainer_teach"` (proven via a mock that captures the payload).
  * Malformed pattern → skip (no pipe opened, returns None).
  * LIVE (VM-gated, SKIP if the pipe is down): ChromaDB + `learned-outcomes` are
    reachable (read-only); with `BOTBRAIN_TEACH_ENABLED` off the write is SKIPPED
    (nothing lands); and the bot's `build_advisory_context` returns "" when off.

Dependency-free: `python3 tests/test_trainer_teach.py`. pytest-compatible.
The live VM tests SKIP (never fail) when the VM pipe is unreachable.
"""
import io
import os
import subprocess
import sys
import tokenize

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

import trainer_teach as tt  # noqa: E402

_MODULE = os.path.join(_REPO, "trainer_teach.py")


def _code_tokens(path):
    """Code token strings only (STRING/COMMENT/FSTRING_MIDDLE stripped) — so the
    docstring that legitimately says the WORDS 'confidence'/'CandidateSignal' does
    not false-flag."""
    src = open(path).read()
    out = []
    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type in (tokenize.STRING, tokenize.COMMENT,
                        getattr(tokenize, "FSTRING_MIDDLE", -1)):
            continue
        if tok.string.strip():
            out.append(tok.string)
    return out


def _vm_up():
    host = os.environ.get("TRAINER_VM_HOST", "vm")
    try:
        p = subprocess.run(["ssh", "-o", "ConnectTimeout=6", "-o", "BatchMode=yes",
                            host, "true"], capture_output=True, timeout=12)
        return p.returncode == 0
    except Exception:
        return False


# ── 1. ANTI-WEIGHT (structural): text-only, no scalar/no CandidateSignal path ──
def test_anti_weight_structural():
    toks = " ".join(_code_tokens(_MODULE))
    # No code path touches a signal object or writes a scalar onto it.
    for needle in ("CandidateSignal", "setattr"):
        assert needle not in toks, f"anti-weight: code token {needle!r} present"
    # The VM program writes documents=[text] ONLY — assert on its CODE (comments,
    # which legitimately explain "no embeddings/no CandidateSignal", are stripped so
    # they don't false-flag — same philosophy as the code-token scan above).
    prog_code = "\n".join(ln.split("#", 1)[0] for ln in tt._VM_PROGRAM.splitlines())
    assert "documents=[text]" in prog_code, "VM program must write documents=[text]"
    assert "col.add(documents=[text]" in prog_code, prog_code[:200]
    for needle in ("embeddings=", "CandidateSignal", "confidence"):
        assert needle not in prog_code, f"anti-weight: VM program CODE references {needle!r}"
    print("  anti-weight structural (text-only, no scalar/CandidateSignal path): PASS")


# ── 2. write-shape via MOCK: a TEXT entry, tagged r9_trainer_teach, no weight key ──
def test_writes_text_entry_mock():
    captured = {}
    orig = tt._vm_call

    def _fake_vm_call(payload, timeout):
        captured["payload"] = payload
        captured["timeout"] = timeout
        return {"wrote": True, "collection": tt.TEACH_COLLECTION,
                "id": payload["doc_id"], "count_before": 1761, "count_after": 1762}

    tt._vm_call = _fake_vm_call
    try:
        out = tt.recommend_execution_guidance({
            "text": "in VOLATILE regime, SOL scalps that survived used tighter stops",
            "ticker": "SOL", "direction": "SHORT", "regime": "VOLATILE", "level_id": 0,
        })
    finally:
        tt._vm_call = orig

    assert out is None, "recommend_execution_guidance returns None"
    p = captured["payload"]
    assert isinstance(p["text"], str) and p["text"].strip(), p          # TEXT
    assert p["collection"] == "learned-outcomes", p                     # the sole target
    assert p["doc_id"].startswith("r9teach-"), p
    md = p["metadata"]
    assert md["source"] == "r9_trainer_teach", md                       # distinguishing tag
    assert md["ticker"] == "SOL" and md["regime"] == "VOLATILE", md
    # Every metadata value is a scalar (str/int/float/bool) — no numeric "weight" smuggled.
    assert all(isinstance(v, (str, int, float, bool)) for v in md.values()), md
    for banned in ("weight", "confidence", "score", "embedding"):
        assert banned not in md, f"metadata carries a {banned!r} key"
        assert banned not in p, f"payload carries a {banned!r} key"
    print("  writes a TEXT entry into learned-outcomes, tagged r9_trainer_teach: PASS")


# ── 3. ISOLATION: guard raises on synthetic / off-allowlist; dispatch opens no pipe ──
def test_isolation_guard_raises():
    for synth in ("training_knowledge", "training_observations", "training_sentiment"):
        try:
            tt._assert_execution_collection(synth)
            assert False, f"isolation guard did NOT raise on synthetic {synth!r}"
        except ValueError:
            pass
    # off-allowlist name raises too.
    try:
        tt._assert_execution_collection("some_random_collection")
        assert False, "isolation guard did NOT raise on an off-allowlist name"
    except ValueError:
        pass
    # the sole allowed target passes.
    tt._assert_execution_collection("learned-outcomes")
    print("  isolation guard raises on 3 synthetic + off-allowlist, passes learned-outcomes: PASS")


def test_isolation_dispatch_opens_no_pipe():
    # A synthetic target must raise in _dispatch_teaching BEFORE any ssh pipe opens.
    orig_run = subprocess.run

    def _poison(*_a, **_k):
        raise AssertionError("isolation breach must not open the ssh pipe")

    subprocess.run = _poison
    try:
        for synth in ("training_knowledge", "training_sentiment"):
            try:
                tt._dispatch_teaching("x", {"source": "r9_trainer_teach"}, "r9teach-z",
                                      collection=synth)
                assert False, f"dispatch did NOT raise on synthetic {synth!r}"
            except ValueError:
                pass
    finally:
        subprocess.run = orig_run
    print("  synthetic-target dispatch raises before the pipe (no RPC): PASS")


# ── 4. malformed pattern → skip, no pipe, returns None ──
def test_malformed_pattern_skipped_no_pipe():
    orig_run = subprocess.run

    def _poison(*_a, **_k):
        raise AssertionError("a malformed pattern must not open the ssh pipe")

    subprocess.run = _poison
    try:
        for bad in (None, 123, [], {}, {"text": ""}, {"text": "   "}, {"no_text": "x"}):
            assert tt.recommend_execution_guidance(bad) is None, bad
    finally:
        subprocess.run = orig_run
    print("  malformed pattern skipped (no pipe, returns None): PASS")


# ── 5. LIVE (VM-gated): ChromaDB + learned-outcomes reachable (read-only) ──
def test_live_chromadb_reachable():
    if not _vm_up():
        print("  live ChromaDB reachability: SKIP (VM pipe unreachable)")
        return
    r = tt.probe_chromadb()
    assert isinstance(r, dict), r
    assert "adapter_error" not in r, r                    # the RPC seam worked
    assert "vm_error" not in r, r                         # chromadb imported VM-side
    assert r.get("chromadb_ok") is True, r
    assert r.get("collection") == "learned-outcomes", r
    # Either the collection exists (a count) or is honestly reported missing.
    assert ("count" in r) or r.get("collection_missing"), r
    print(f"  live: ChromaDB reachable, learned-outcomes count={r.get('count')}: PASS")


# ── 6. LIVE (VM-gated): flag OFF ⇒ write SKIPPED (nothing lands) ──
def test_live_flag_off_write_skipped():
    if not _vm_up():
        print("  live flag-off write-skip: SKIP (VM pipe unreachable)")
        return
    # BOTBRAIN_TEACH_ENABLED is OFF live → the VM program must SKIP before any .add().
    result = tt._dispatch_teaching(
        "R9-B5 live gate probe (must be skipped while the flag is off)",
        {"source": "r9_trainer_teach", "ts": "probe"}, "r9teach-liveprobe-DISCARD")
    assert isinstance(result, dict), result
    assert "adapter_error" not in result, result           # RPC reached the VM
    assert result.get("wrote") is False, result            # NOTHING written
    assert "off" in str(result.get("skipped", "")).lower(), result
    print(f"  live: flag OFF ⇒ write skipped, nothing lands ({result.get('skipped')}): PASS")


# ── 7. LIVE (VM-gated): bot's build_advisory_context returns "" when flag OFF ──
def test_live_advisory_empty_when_flag_off():
    if not _vm_up():
        print("  live advisory-empty-when-off: SKIP (VM pipe unreachable)")
        return
    remote = (
        "cd /home/trevor/trevor && sudo -u trevor venv/bin/python3 -c "
        "'import bot_brain_teach; print(repr(bot_brain_teach.build_advisory_context(object())))'"
    )
    p = subprocess.run(["ssh", os.environ.get("TRAINER_VM_HOST", "vm"), remote],
                       capture_output=True, text=True, timeout=60, check=False)
    out = (p.stdout or "").strip()
    assert out.endswith("''"), f"build_advisory_context(off) not empty: {out!r} / {p.stderr[:200]}"
    print("  live: bot build_advisory_context returns '' when flag OFF (byte-identical): PASS")


_TESTS = [
    test_anti_weight_structural,
    test_writes_text_entry_mock,
    test_isolation_guard_raises,
    test_isolation_dispatch_opens_no_pipe,
    test_malformed_pattern_skipped_no_pipe,
    test_live_chromadb_reachable,
    test_live_flag_off_write_skipped,
    test_live_advisory_empty_when_flag_off,
]


if __name__ == "__main__":
    print("=== trainer_teach tests (R9-B5) ===")
    fails = 0
    for t in _TESTS:
        try:
            t()
        except AssertionError as e:
            fails += 1
            print(f"  {t.__name__}: FAIL — {e}")
        except Exception as e:  # noqa: BLE001
            fails += 1
            print(f"  {t.__name__}: ERROR — {type(e).__name__}: {e}")
    print(f"=== {len(_TESTS) - fails}/{len(_TESTS)} PASS ===")
    sys.exit(1 if fails else 0)
