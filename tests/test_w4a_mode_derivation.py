#!/usr/bin/env python3
"""W4a — the mode-derivation controls, both halves of the chain.

🚨 RUNNER: a `__main__` self-runner, NOT pytest. pytest is genuinely absent from
this WSL venv (`ModuleNotFoundError: No module named 'pytest'`) — CLAUDE.md's
measurement law 4. Run it with:

    venv/bin/python3 tests/test_w4a_mode_derivation.py

🚨 WHAT THIS PROVES, AND WHY IT IS BUILT THIS WAY.

The W4a gate requires three controls on the mode badge: paper ON reads PAPER,
paper OFF reads LIVE, and a FAILED READ reads PAPER. Two of those cannot be
exercised by flipping the live flag — `PAPER_WINDOW_ENABLED` is the BOT's gate
on the VM, and flipping it to prove a Hub badge would be using a live trading
control as a test fixture. It is not the Hub's to touch.

So the controls DRIVE THE DERIVATION with each input instead, against the REAL
loaded functions on both sides of the wire:

  · Python  — `query_auto_state._paper_window_state`, imported from the module
              the Hub actually runs. Not a re-implementation.
  · TypeScript — `src/lib/trading-mode.ts`, compiled by the repo's own tsc into
              a scratch dir and required by node. Also not a re-implementation.

That distinction is load-bearing: a re-implementation can faithfully reproduce
the very bug it is meant to catch, so a control that re-states the logic proves
nothing. (CLAUDE.md's B9 lesson — prove against the actual loaded function.)

NEGATIVE CONTROL: `off` MUST produce LIVE. A Hub that always says PAPER is the
same defect inverted, and would pass a naive "does it say PAPER?" check.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

FAILURES: list[str] = []
CHECKS = 0


def check(label: str, got, want) -> None:
    global CHECKS
    CHECKS += 1
    if got == want:
        print(f"  PASS  {label}: {got!r}")
    else:
        print(f"  FAIL  {label}: got {got!r}, want {want!r}")
        FAILURES.append(f"{label}: got {got!r}, want {want!r}")


# ─────────────────────────────────────────────────────────────────────────────
# 1. THE PYTHON HALF — query_auto_state._paper_window_state
# ─────────────────────────────────────────────────────────────────────────────
def test_python_derivation() -> None:
    print("\n[1] Python — query_auto_state._paper_window_state (REAL module)")
    import query_auto_state as qas

    # Paper window ON — the state the bot is in right now.
    check("cfg true            -> state", qas._paper_window_state({"PAPER_WINDOW_ENABLED": "true"})[0], "on")
    check("cfg true            -> paper", qas._paper_window_state({"PAPER_WINDOW_ENABLED": "true"})[1], True)
    check("cfg 'TRUE' (case)   -> state", qas._paper_window_state({"PAPER_WINDOW_ENABLED": "TRUE"})[0], "on")
    check("cfg ' true ' (ws)   -> state", qas._paper_window_state({"PAPER_WINDOW_ENABLED": " true "})[0], "on")

    # 🚨 NEGATIVE CONTROL — the window closed. MUST be distinguishable.
    check("cfg false           -> state", qas._paper_window_state({"PAPER_WINDOW_ENABLED": "false"})[0], "off")
    check("cfg false           -> paper", qas._paper_window_state({"PAPER_WINDOW_ENABLED": "false"})[1], False)

    # Key absent. NOT "off" — the VM DEFAULTS map absent to 'false', so the bot
    # would be executing live; a confident PAPER here would claim unproven safety.
    check("key absent          -> state", qas._paper_window_state({})[0], "absent")
    check("key absent          -> paper", qas._paper_window_state({})[1], True)
    check("other keys only     -> state", qas._paper_window_state({"AUTO_LIVE_ENABLED": "true"})[0], "absent")

    # 🚨 Junk values must never read as "off". "off" is the ONLY state that
    # renders a confident LIVE, and a value nobody can parse is not evidence
    # that the paper window is closed. They land on "absent" => PAPER?.
    # (This case caught a real defect during W4a: the first draft mapped
    # "anything not 'true'" to "off", so a blank row rendered LIVE.)
    for junk in ("", "yes", "1", "None", "null", "paper", "TRUEISH", "0"):
        state, is_paper = qas._paper_window_state({"PAPER_WINDOW_ENABLED": junk})
        check(f"junk {junk!r:9} -> absent", (state, is_paper), ("absent", True))

    # 🚨 THE FAIL-SAFE DEFAULT: the dict shipped on the DB-missing / exception
    # paths must already be in a paper-coloured state before any read happens.
    src = (REPO / "query_auto_state.py").read_text()
    assert '"paper_window_state": "error"' in src, "fail-safe default missing"
    print("  PASS  fail-safe default in out{} is 'error' (renders PAPER)")
    global CHECKS
    CHECKS += 1


# ─────────────────────────────────────────────────────────────────────────────
# 2. THE TYPESCRIPT HALF — src/lib/trading-mode.ts, compiled and executed
# ─────────────────────────────────────────────────────────────────────────────
NODE_DRIVER = r"""
const m = require(process.argv[2]);
const cases = [
  // [label, hasData, autoEnabled, rawStateFromPayload, expectLabel, expectIntent]
  ["paper ON            ", true,  true,  "on",        "PAPER",    "warn"],
  ["paper OFF (NEG CTRL)", true,  true,  "off",       "LIVE",     "live"],
  ["key ABSENT          ", true,  true,  "absent",    "PAPER?",   "warn"],
  ["read ERROR          ", true,  true,  "error",     "PAPER",    "warn"],
  ["field MISSING       ", true,  true,  undefined,   "PAPER",    "warn"],
  ["field null          ", true,  true,  null,        "PAPER",    "warn"],
  ["field garbage       ", true,  true,  "LIVE",      "PAPER",    "warn"],
  ["field bool true     ", true,  true,  true,        "PAPER",    "warn"],
  ["autotrader disabled ", true,  false, "off",       "DISABLED", "error"],
  ["no data yet         ", false, true,  "on",        "LOADING",  "warn"],
];
const out = [];
for (const [label, hasData, autoEnabled, raw, wantLabel, wantIntent] of cases) {
  const state = m.normalizePaperWindowState(raw);
  const badge = m.resolveModeBadge({ hasData, autoEnabled, state });
  out.push({ label, state, label_: badge.label, intent: badge.intent, wantLabel, wantIntent,
             ok: badge.label === wantLabel && badge.intent === wantIntent });
}
// The label-visibility helpers used by the row/hero markers.
const helpers = {
  isPaperMode_on:     m.isPaperMode("on"),
  isPaperMode_off:    m.isPaperMode("off"),
  isPaperMode_absent: m.isPaperMode("absent"),
  isPaperMode_error:  m.isPaperMode("error"),
  confirmed_on:       m.isModeConfirmed("on"),
  confirmed_off:      m.isModeConfirmed("off"),
  confirmed_absent:   m.isModeConfirmed("absent"),
  disagree_liveflag_paperwindow: m.configuredDisagrees({ liveEnabled: true, state: "on" }),
  disagree_liveflag_liveWindow:  m.configuredDisagrees({ liveEnabled: true, state: "off" }),
};
console.log(JSON.stringify({ cases: out, helpers }));
"""


def test_typescript_derivation() -> None:
    print("\n[2] TypeScript — src/lib/trading-mode.ts (compiled by the repo's tsc)")
    scratch = tempfile.mkdtemp(prefix="w4a-", dir=str(Path.home()))  # /home, never /tmp
    try:
        cp = subprocess.run(
            ["npx", "tsc", "src/lib/trading-mode.ts",
             "--outDir", scratch, "--module", "commonjs", "--target", "es2020"],
            cwd=str(REPO), capture_output=True, text=True, timeout=180,
        )
        if cp.returncode != 0:
            FAILURES.append(f"tsc compile failed: {cp.stdout}{cp.stderr}")
            print(f"  FAIL  tsc compile: {cp.stdout}{cp.stderr}")
            return
        compiled = os.path.join(scratch, "trading-mode.js")
        driver = os.path.join(scratch, "driver.js")
        Path(driver).write_text(NODE_DRIVER)
        run = subprocess.run(["node", driver, compiled],
                             capture_output=True, text=True, timeout=60)
        if run.returncode != 0:
            FAILURES.append(f"node driver failed: {run.stderr}")
            print(f"  FAIL  node driver: {run.stderr}")
            return
        data = json.loads(run.stdout)
        for c in data["cases"]:
            check(f"{c['label']} -> {c['state']:>7}", (c["label_"], c["intent"]),
                  (c["wantLabel"], c["wantIntent"]))
        h = data["helpers"]
        check("isPaperMode('on')            ", h["isPaperMode_on"], True)
        check("isPaperMode('off') NEG CTRL  ", h["isPaperMode_off"], False)
        check("isPaperMode('absent')        ", h["isPaperMode_absent"], True)
        check("isPaperMode('error')         ", h["isPaperMode_error"], True)
        check("isModeConfirmed('on')        ", h["confirmed_on"], True)
        check("isModeConfirmed('off')       ", h["confirmed_off"], True)
        check("isModeConfirmed('absent')    ", h["confirmed_absent"], False)
        check("configured split shown       ", h["disagree_liveflag_paperwindow"], True)
        check("configured split hidden(live)", h["disagree_liveflag_liveWindow"], False)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


# ─────────────────────────────────────────────────────────────────────────────
# 3. THE COUNT — the mode filter is gone from the AUTO readers
# ─────────────────────────────────────────────────────────────────────────────
def test_no_mode_filter_in_auto_readers() -> None:
    print("\n[3] The count — no trade_mode='live' left in the AUTO read path")
    for rel in ("query_auto_state.py", "query_auto_trades.py",
                "query_profit_risk.py", "query_leverage_regime.py",
                "src/app/api/nav-badges/route.ts"):
        src = (REPO / rel).read_text()
        # Count REAL SQL only, not the comments/docstrings explaining the
        # removal. Prose in this repo quotes identifiers in `backticks`; the
        # actual SQL never does. Combined with the comment-prefix skip that is
        # a reliable discriminator — and it is deliberately conservative: a
        # false POSITIVE here just makes someone re-read a line, whereas a
        # false negative would let the filter creep back in unnoticed.
        offending = [
            ln.strip() for ln in src.splitlines()
            if "trade_mode='live'" in ln
            and not ln.lstrip().startswith(("#", "//", "--", "*"))
            and "`" not in ln
        ]
        check(f"{rel:34} clean", offending, [])


def main() -> int:
    print("W4a mode-derivation controls  (self-runner; pytest absent on WSL)")
    print("=" * 68)
    test_python_derivation()
    test_typescript_derivation()
    test_no_mode_filter_in_auto_readers()
    print("=" * 68)
    if FAILURES:
        print(f"FAILED — {len(FAILURES)} of {CHECKS} checks")
        for f in FAILURES:
            print(f"  · {f}")
        return 1
    print(f"PASSED — {CHECKS}/{CHECKS} checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
