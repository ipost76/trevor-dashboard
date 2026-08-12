#!/usr/bin/env python3
"""[B2] Phase 2 — prove the re-keyed G-5 gate separates what MAX(id) could not.

🚨 EVERY DATABASE HERE IS BUILT IN SCRATCH FROM LITERAL VALUES. Nothing in this
file opens, reads or points at a live ledger. The rows below were MEASURED from
the live boxes and then transcribed as constants, so the test is reproducible
after the live data has moved on (it moves every few minutes).

Both halves are proven:
  the CATCH  — the eight rows the old key passed, separated by the new one
  the QUIET  — three legitimate differences that must NOT trip it
  the NEGATIVE CONTROL — an injected inherited-set divergence that MUST trip it,
                          because a check that cannot fail proves nothing.
"""
import json
import os
import shutil
import sqlite3
import tempfile
import subprocess
import sys

# Runs from wherever tailsync_gate.py lives; scratch goes in a temp dir that is
# removed at the end. 🚨 It never opens a live replica -- every database here is
# built from the literal rows transcribed below.
STAGE = os.path.dirname(os.path.abspath(__file__))
HERE = tempfile.mkdtemp(prefix="tailsync-gate-test-")
sys.path.insert(0, STAGE)
import tradekey                                              # noqa: E402

CONF = os.path.join(STAGE, "tailsync-gate.conf")
GATE = os.path.join(STAGE, "tailsync_gate.py")
T0 = "2026-08-10 22:48:51"

VM_SRC = "vm:100.95.174.30:/home/trevor/trevor/trevor.db"
SHADOW_SRC = "trevor-prime-3:100.89.253.42:/home/trevor/trevor/trevor.db"

# -- INHERITED (opened at or before t0): identical on both boxes by construction.
#    Transcribed from the two live ledgers 2026-08-11.
INHERITED = [
    (101815, "FARTCOIN", "LONG",  "2026-08-10 22:19:05"),
    (101816, "kPEPE",    "LONG",  "2026-08-10 22:24:31"),
    (101779, "XRP",      "SHORT", "2026-08-04 23:42:09"),
    (101777, "SOL",      "SHORT", "2026-08-04 20:28:59"),
]

# -- 🚨 THE EIGHT ROWS THAT FOOLED THE OLD KEY.
#    Four ids; at each one the two boxes hold a DIFFERENT TRADE. 101823/101824
#    are RM-VERIFY's measurement (@10:50:10, when both boxes also read
#    MAX(id)=101824 / rows=1839 / open=2 simultaneously); 101826/101831 are this
#    prompt's, measured 2026-08-11 20:48-20:51.
FORKED = [
    # id,     VM ticker/dir/opened_at,                    shadow ticker/dir/opened_at
    (101823, ("HYPE", "LONG",  "2026-08-11 09:14:02"), ("NEAR",     "LONG",  "2026-08-11 09:51:17")),
    (101824, ("NEAR", "LONG",  "2026-08-11 10:02:44"), ("kPEPE",    "SHORT", "2026-08-11 10:46:25")),
    (101826, ("XRP",  "SHORT", "2026-08-11 10:57:52"), ("FARTCOIN", "SHORT", "2026-08-11 12:22:31")),
    (101831, ("DOGE", "LONG",  "2026-08-11 16:48:38"), ("FARTCOIN", "LONG",  "2026-08-11 17:46:30")),
]

RESULTS = []


def build(path, rows):
    """Create a scratch replica containing exactly `rows`."""
    if os.path.exists(path):
        os.remove(path)
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE auto_trades (id INTEGER PRIMARY KEY AUTOINCREMENT,"
                " ticker TEXT, direction TEXT, opened_at TEXT, closed_at TEXT)")
    con.executemany("INSERT INTO auto_trades (id,ticker,direction,opened_at) "
                    "VALUES (?,?,?,?)", rows)
    con.commit()
    con.close()


def run_gate(staged, published, source):
    """-> (rc, report dict). Invokes the real script, not an inlined copy."""
    p = subprocess.run([sys.executable, GATE, "check", "--staged", staged,
                        "--published", published, "--source", source,
                        "--conf", CONF],
                       capture_output=True, text=True)
    try:
        return p.returncode, json.loads(p.stdout)
    except ValueError:
        return p.returncode, {"decision": "UNPARSEABLE", "stdout": p.stdout,
                              "stderr": p.stderr}


def sidecar(published, source):
    subprocess.run([sys.executable, GATE, "record", "--published", published,
                    "--source", source], capture_output=True, text=True)


def check(label, kind, ok, detail):
    RESULTS.append((kind, label, ok, detail))
    print("  [%s] %-7s %-52s %s" % ("PASS" if ok else "FAIL", kind, label, detail))


# ==========================================================================
print("\n" + "=" * 74)
print("1. THE CATCH — the eight rows the old MAX(id) key passed")
print("=" * 74)

vm_rows = [(i, t, d, o) for i, t, d, o in INHERITED] + \
          [(i, a[0], a[1], a[2]) for i, a, _ in FORKED]
sh_rows = [(i, t, d, o) for i, t, d, o in INHERITED] + \
          [(i, b[0], b[1], b[2]) for i, _, b in FORKED]

vm_db = os.path.join(HERE, "vm.db")
sh_db = os.path.join(HERE, "shadow.db")
build(vm_db, vm_rows)
build(sh_db, sh_rows)

# -- BEFORE: the old key, reproduced exactly as it was written -----------------
def old_maxid(p):
    con = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
    try:
        return int(con.execute(
            "SELECT COALESCE(MAX(id),0) FROM auto_trades").fetchone()[0] or 0)
    finally:
        con.close()

vm_max, sh_max = old_maxid(vm_db), old_maxid(sh_db)
old_verdict = "PUBLISH (staged >= current)" if sh_max >= vm_max else "ABORT"
check("BEFORE: old key sees the two ledgers as interchangeable", "CATCH",
      vm_max == sh_max and old_verdict.startswith("PUBLISH"),
      "MAX(id) %d == %d -> %s" % (vm_max, sh_max, old_verdict))

# -- AFTER: the new key, on the same two files --------------------------------
sidecar(vm_db, VM_SRC)                      # published replica came from the VM
rc, rep = run_gate(sh_db, vm_db, SHADOW_SRC)   # staged snapshot came from shadow
check("AFTER: new key refuses and names it a SOURCE CHANGE", "CATCH",
      rc == 1 and rep["class"] == "SOURCE_CHANGE_UNACKED",
      "rc=%d class=%s" % (rc, rep["class"]))
check("AFTER: inherited set intact -> NOT called corruption", "CATCH",
      "NOT CORRUPTION AND NOT A TRUNCATION" in rep["why"].upper()
      and rep["checks"]["inherited"]["published"] == len(INHERITED),
      "inherited %d/%d, none lost" % (rep["checks"]["inherited"]["staged"],
                                      rep["checks"]["inherited"]["published"]))
check("AFTER: the 8 forked rows separate into 4+4 unmatched", "CATCH",
      rep["checks"]["post_start_pairing"]["matched"] == 0
      and rep["checks"]["post_start_pairing"]["only_in_published"] == 4
      and rep["checks"]["post_start_pairing"]["only_in_staged"] == 4,
      "matched=%d pub-only=%d stg-only=%d"
      % (rep["checks"]["post_start_pairing"]["matched"],
         rep["checks"]["post_start_pairing"]["only_in_published"],
         rep["checks"]["post_start_pairing"]["only_in_staged"]))
check("AFTER: MAX(id) demoted — present as context, gates nothing", "CATCH",
      rep["context"]["auto_trades_max_id"]["staged"] == sh_max
      and "NOT a cross-box key" in json.dumps(rep["context"]),
      "context max_id staged=%d published=%d, labelled"
      % (rep["context"]["auto_trades_max_id"]["staged"],
         rep["context"]["auto_trades_max_id"]["published"]))

# per-row proof that the KEY itself separates them
seps = sum(1 for _, a, b in FORKED
           if tradekey.trade_key(*a) != tradekey.trade_key(*b))
check("AFTER: key(ticker|direction|opened_at) differs on all 4 ids", "CATCH",
      seps == 4, "%d/4 ids separated by the key alone" % seps)


# ==========================================================================
print("\n" + "=" * 74)
print("2. THE QUIET HALF — legitimate difference must NOT trip it")
print("=" * 74)

# (a) legitimately independent post-start trades on two different boxes
a_db = os.path.join(HERE, "q_a.db")
b_db = os.path.join(HERE, "q_b.db")
build(a_db, [(i, t, d, o) for i, t, d, o in INHERITED]
      + [(101820, "DOGE", "LONG", "2026-08-11 14:00:00")])
build(b_db, [(i, t, d, o) for i, t, d, o in INHERITED]
      + [(101820, "SUI", "SHORT", "2026-08-11 19:00:00")])
sidecar(a_db, VM_SRC)
rc, rep = run_gate(b_db, a_db, SHADOW_SRC)
check("(a) independent post-start books -> UNCOMPARABLE, not DIVERGED", "QUIET",
      "UNCOMPARABLE" in rep["checks"]["post_start_pairing"]["verdict"]
      and rep["class"] != "TRUNCATION",
      "class=%s pairing=UNCOMPARABLE" % rep["class"])
# and with the change acknowledged, it publishes rather than blocking forever
with open(os.path.join(HERE, ".source-change-ack"), "w") as fh:
    fh.write(SHADOW_SRC + "\n")
rc, rep = run_gate(b_db, a_db, SHADOW_SRC)
check("(a) acked source change publishes — no forever-abort", "QUIET",
      rc == 0 and rep["class"] == "SOURCE_CHANGE_ACKED",
      "rc=%d class=%s" % (rc, rep["class"]))
os.remove(os.path.join(HERE, ".source-change-ack"))

# (b) the SAME trade opened within the window on both boxes
build(a_db, [(i, t, d, o) for i, t, d, o in INHERITED]
      + [(101820, "NEAR", "LONG", "2026-08-11 18:03:44")])
build(b_db, [(i, t, d, o) for i, t, d, o in INHERITED]
      + [(101820, "NEAR", "LONG", "2026-08-11 18:05:01")])   # +77s, real pair
sidecar(a_db, VM_SRC)
rc, rep = run_gate(b_db, a_db, SHADOW_SRC)
pp = rep["checks"]["post_start_pairing"]
check("(b) same trade 77s apart -> MATCHED inside the 190s window", "QUIET",
      pp["matched"] == 1 and pp["only_in_published"] == 0
      and pp["only_in_staged"] == 0 and pp["window_s"] == 190.0,
      "matched=1 window=%ss (%s)" % (pp["window_s"],
                                     pp["window_provenance"][:34]))

# (c) an empty post-start set on one side
build(a_db, [(i, t, d, o) for i, t, d, o in INHERITED])
build(b_db, [(i, t, d, o) for i, t, d, o in INHERITED]
      + [(101820, "DOGE", "LONG", "2026-08-11 14:00:00")])
sidecar(a_db, VM_SRC)
rc, rep = run_gate(b_db, a_db, VM_SRC)     # SAME source: staged is a superset
check("(c) empty on one side, superset staged -> PUBLISH, no trip", "QUIET",
      rc == 0 and rep["class"] == "SAME_SOURCE_MONOTONIC",
      "rc=%d class=%s" % (rc, rep["class"]))

# (d) the ordinary case this gate runs 67x/day: same source, newer snapshot
build(a_db, [(i, t, d, o) for i, t, d, o in INHERITED]
      + [(101820, "DOGE", "LONG", "2026-08-11 14:00:00")])
build(b_db, [(i, t, d, o) for i, t, d, o in INHERITED]
      + [(101820, "DOGE", "LONG", "2026-08-11 14:00:00"),
         (101821, "SUI", "SHORT", "2026-08-11 20:00:00")])
sidecar(a_db, VM_SRC)
rc, rep = run_gate(b_db, a_db, VM_SRC)
check("(d) same source, newer snapshot -> PUBLISH (the 67x/day case)", "QUIET",
      rc == 0 and rep["class"] == "SAME_SOURCE_MONOTONIC",
      "rc=%d class=%s" % (rc, rep["class"]))


# ==========================================================================
print("\n" + "=" * 74)
print("3. NEGATIVE CONTROLS — it must still be able to fail")
print("=" * 74)

# (e) genuine divergence INJECTED INTO THE INHERITED SET
build(a_db, [(i, t, d, o) for i, t, d, o in INHERITED])
build(b_db, [(i, t, d, o) for i, t, d, o in INHERITED[:-1]])   # one lost
sidecar(a_db, VM_SRC)
rc, rep = run_gate(b_db, a_db, SHADOW_SRC)     # even ACROSS boxes it must trip
check("(e) inherited row missing -> TRUNCATION, across boxes", "NEG",
      rc == 1 and rep["class"] == "TRUNCATION"
      and len(rep["checks"]["inherited_lost"]) == 1,
      "rc=%d class=%s lost=%s" % (rc, rep["class"],
                                  rep["checks"]["inherited_lost"]))

# (f) same-source post-start loss — MAX(id) could not see this at all
build(a_db, [(i, t, d, o) for i, t, d, o in INHERITED]
      + [(101820, "DOGE", "LONG", "2026-08-11 14:00:00"),
         (101821, "SUI", "SHORT", "2026-08-11 20:00:00")])
build(b_db, [(i, t, d, o) for i, t, d, o in INHERITED]
      + [(101821, "SUI", "SHORT", "2026-08-11 20:00:00")])    # 101820 deleted
sidecar(a_db, VM_SRC)
rc, rep = run_gate(b_db, a_db, VM_SRC)
old_would = "PUBLISH" if old_maxid(b_db) >= old_maxid(a_db) else "ABORT"
check("(f) same-source row deleted below the max -> TRUNCATION", "NEG",
      rc == 1 and rep["class"] == "TRUNCATION",
      "rc=%d class=%s (old MAX(id) key would have said %s)"
      % (rc, rep["class"], old_would))

# (g) empty / unreadable staged db -> the retained VALIDITY arm
build(a_db, [(i, t, d, o) for i, t, d, o in INHERITED])
build(b_db, [])
sidecar(a_db, VM_SRC)
rc, rep = run_gate(b_db, a_db, VM_SRC)
check("(g) empty staged db -> STAGED_INVALID (the kept <=0 arm)", "NEG",
      rc == 1 and rep["class"] == "STAGED_INVALID",
      "rc=%d class=%s" % (rc, rep["class"]))

# (h) tradekey.py drift -> FAIL CLOSED
bad = os.path.join(HERE, "bad-pin.conf")
with open(CONF) as fh:
    txt = fh.read()
with open(bad, "w") as fh:
    fh.write(txt.replace(tradekey.file_sha256(), "0" * 64))
p = subprocess.run([sys.executable, GATE, "check", "--staged", a_db,
                    "--published", a_db, "--source", VM_SRC, "--conf", bad],
                   capture_output=True, text=True)
rep = json.loads(p.stdout)
check("(h) drifted tradekey pin -> ABORT, fail closed", "NEG",
      p.returncode == 1 and rep["class"] == "TRADEKEY_DRIFT",
      "rc=%d class=%s" % (p.returncode, rep["class"]))

# (i) an ABSENT pin must not read as "unpinned, carry on"
with open(bad, "w") as fh:
    fh.write("t0_naive_et = %s\n" % T0)
p = subprocess.run([sys.executable, GATE, "check", "--staged", a_db,
                    "--published", a_db, "--source", VM_SRC, "--conf", bad],
                   capture_output=True, text=True)
rep = json.loads(p.stdout)
check("(i) absent pin -> ABORT, not a silent pass", "NEG",
      p.returncode == 1 and rep["class"] == "TRADEKEY_DRIFT",
      "rc=%d class=%s" % (p.returncode, rep["class"]))

# (j) t0 undeclared -> refuse to assert, and say the replica is fine
with open(bad, "w") as fh:
    fh.write("tradekey_sha256 = %s\n" % tradekey.file_sha256())
p = subprocess.run([sys.executable, GATE, "check", "--staged", a_db,
                    "--published", a_db, "--source", VM_SRC, "--conf", bad],
                   capture_output=True, text=True)
rep = json.loads(p.stdout)
check("(j) t0 undeclared -> ABORT as CONFIG gap, not a data defect", "NEG",
      p.returncode == 1 and rep["class"] == "T0_UNDECLARED"
      and "not a data defect" in rep["why"],
      "rc=%d class=%s" % (p.returncode, rep["class"]))

# (k) TZ-independence: the boundary must not move with the box's clock
os.environ["TZ"] = "UTC"
import time as _t
_t.tzset()
utc_t0 = tradekey.ts_epoch(T0)
utc_row = tradekey.ts_epoch("2026-08-11 10:57:52")
os.environ["TZ"] = "America/New_York"
_t.tzset()
et_t0 = tradekey.ts_epoch(T0)
et_row = tradekey.ts_epoch("2026-08-11 10:57:52")
check("(k) partition side is TZ-independent (t0 parsed like the rows)", "NEG",
      (utc_row > utc_t0) == (et_row > et_t0) and utc_t0 != et_t0,
      "UTC and ET disagree on absolute epoch by %.0fh but agree on the side"
      % (abs(utc_t0 - et_t0) / 3600.0))


# ==========================================================================
n_pass = sum(1 for _, _, ok, _ in RESULTS if ok)
print("\n" + "=" * 74)
for kind in ("CATCH", "QUIET", "NEG"):
    sub = [r for r in RESULTS if r[0] == kind]
    print("%-6s %d/%d" % (kind, sum(1 for r in sub if r[2]), len(sub)))
print("TOTAL  %d/%d" % (n_pass, len(RESULTS)))
shutil.rmtree(HERE, ignore_errors=True)
print("scratch removed: %s" % (not os.path.exists(HERE)))
print("=" * 74)
sys.exit(0 if n_pass == len(RESULTS) else 1)
