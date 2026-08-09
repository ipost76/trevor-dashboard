#!/usr/bin/env python3
"""B4-PROOF — the one-tick hold: a transient edge posts ONE line, a sustained one still pages.

🚨 ZERO NETWORK. `alert_delivery.post_alert` is replaced by a recorder that RENDERS the
real builder and captures the text, so every assertion below is made against the exact
string that would have been POSTed — never against a re-implementation of it. Nothing
reaches Discord, and `FUNNEL_WATCH_NO_HEAL=1` means no real `tailscale` call is ever made.

Run: python3 tests/test_funnel_transient.py     (pytest is genuinely absent on WSL — Law 4)
"""
from __future__ import annotations

import atexit
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

os.environ["FUNNEL_WATCH_NO_HEAL"] = "1"   # never touch the real Funnel
os.environ.setdefault("DISCORD_BOT_TOKEN", "")

import alert_delivery as ad          # noqa: E402
import funnel_edge_watch as f        # noqa: E402

PASS, FAIL = [], []


def check(name: str, cond: object, extra: object = "") -> None:
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"   [{extra}]" if extra and not cond else ""))


# ── the recorder: renders the real builder, posts nothing ────────────────────
class Recorder:
    def __init__(self) -> None:
        self.sent: list[str] = []

    def __call__(self, render, *, source, dry_run=False, log=None):
        payload = render("#qa-agent (bot-token)", None)
        self.sent.append(str(payload.get("content") if isinstance(payload, dict) else payload))
        return ad.Delivery(True, 2, "#qa-agent (bot-token)", "#qa-agent (bot-token)")


class FailingRecorder(Recorder):
    def __call__(self, render, *, source, dry_run=False, log=None):
        super().__call__(render, source=source)
        return ad.Delivery(False, 2, "x", "x", "simulated delivery failure")


DEAD_ERR = ("curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to "
            "trevorhub-wsl.tail2bf7a3.ts.net:443")
DEAD = (35, "000", "209.177.145.97", DEAD_ERR)          # reached the edge, TLS killed
OK = (0, "307", "209.177.145.97", "")
UNRESOLVED = (6, "000", "", "curl: (6) Couldn't resolve host name")


class Harness:
    """Drives real main() ticks against a scratch state file with scripted probes."""

    def __init__(self, recorder=None, canary=True, run_ts=None):
        # Scratch under /home, never /tmp (noexec by house rule), and cleaned up: a test
        # that litters the scratch dir every run is its own small mess.
        self.dir = tempfile.mkdtemp(prefix="b4-funnel-", dir=str(Path.home() / "tmp"))
        atexit.register(shutil.rmtree, self.dir, True)
        self.state = Path(self.dir) / "state.json"
        os.environ["FUNNEL_WATCH_STATE"] = str(self.state)
        f.STATE_FILE = self.state
        self.rec = recorder or Recorder()
        ad.post_alert = self.rec
        self.queue: list[tuple] = []
        f.probe = lambda max_time=20, subproc_timeout=60: self.queue.pop(0)
        f.canary_ok = lambda: canary
        if run_ts is not None:
            f._run_ts = run_ts

    def tick(self, *probes) -> None:
        """One main() run. `probes` feeds classify() then any heal re-probe."""
        self.queue = list(probes)
        f.main()

    @property
    def st(self) -> dict:
        return json.loads(self.state.read_text())

    @property
    def sent(self) -> list[str]:
        return self.rec.sent


def fresh(**kw) -> Harness:
    f._run_ts = _REAL_RUN_TS
    return Harness(**kw)


_REAL_RUN_TS = f._run_ts


# ═════════════════════════════════════════════════════════════════════════════
print("\n[1] flap-and-recover -> EXACTLY ONE 🔵 INFO line")
h = fresh()
h.tick(DEAD)                       # fails=1, grace window
check("grace tick posts nothing", h.sent == [], repr(h.sent))
h.tick(DEAD, DEAD)                 # fails=2 -> heal -> re-probe still dead -> HOLD
check("held tick posts nothing", h.sent == [], repr(h.sent))
check("state records the hold", bool(h.st.get("pending")), repr(h.st.get("pending")))
h.tick(OK)                         # next tick healthy -> ONE info line
check("exactly one message for the whole flap", len(h.sent) == 1, f"{len(h.sent)}: {h.sent}")
info = h.sent[0]
print(f"      -> {info}")
check("it is STRICTLY one line", "\n" not in info, repr(info))
check("severity is INFO from the house four", info.startswith("\U0001F535 INFO — "), info[:20])
check("<= 900 chars", len(info) <= ad.MAX_CHARS, str(len(info)))
check("names the box", f"({ad.BOX})" in info, info)
check("carries an ET stamp", (" EDT" in info or " EST" in info), info)
check("says what happened", "flapped" in info and "recovered on its own" in info, info)
check("names a window with both ends", info.count(":") >= 2 and "–" in info, info)
check("no false green: never says RECOVERED/BROKEN",
      "RECOVERED" not in info and "BROKEN" not in info, info)
check("hold cleared after delivery", h.st.get("pending") is None, repr(h.st.get("pending")))

print("\n[2] SUSTAINED outage -> still pages at FULL severity, revive command intact")
h = fresh()
h.tick(DEAD)
h.tick(DEAD, DEAD)                 # HOLD
check("still silent while held", h.sent == [], repr(h.sent))
h.tick(DEAD, DEAD)                 # still dead one cycle later -> ESCALATE
check("exactly one page", len(h.sent) == 1, f"{len(h.sent)}: {h.sent}")
page = h.sent[0]
print("      -> " + page.replace("\n", "\n         "))
check("severity is BROKEN", page.startswith("\U0001F6A8 BROKEN — "), page[:20])
check("carries the revive command",
      "sudo tailscale funnel --https=443 off" in page and "--bg --https=443 3000" in page, page)
check("NOT collapsed to an INFO line", "INFO" not in page, page)
check("names the held window", "held since" in page, page)
check("<= 8 lines", len(page.splitlines()) <= ad.MAX_LINES, str(len(page.splitlines())))
check("<= 900 chars", len(page) <= ad.MAX_CHARS, str(len(page)))
check("hold cleared on escalation", h.st.get("pending") is None, repr(h.st.get("pending")))

print("\n[3] the error payload appears ONCE")
check("curl error printed exactly once", page.count("SSL_ERROR_SYSCALL") == 1,
      f"{page.count('SSL_ERROR_SYSCALL')}x")
check("back-reference used instead of a second copy", "(same as above)" in page, page)
# negative control: two DIFFERENT errors must BOTH survive — dedupe must not hide a fact.
both = f._dedupe_err("rc=35 err=alpha", "re-armed; re-probe rc=6 err=beta")
check("NEGATIVE CONTROL: distinct errors are both kept", "beta" in both and "same as above" not in both, both)

print("\n[4] UNKNOWN -> HOLD, don't clear, don't post (the stranding hazard)")
h = fresh()
h.tick(DEAD)
h.tick(DEAD, DEAD)                 # HOLD
h.rec.sent.clear()
f.canary_ok = lambda: False        # egress down -> UNKNOWN
h.tick(UNRESOLVED)
check("UNKNOWN posts nothing", h.sent == [], repr(h.sent))
check("UNKNOWN does not clear the hold", bool(h.st.get("pending")), repr(h.st.get("pending")))
check("UNKNOWN does not clear the status", h.st["status"] == "DEAD", h.st["status"])
f.canary_ok = lambda: True
h.tick(OK)                         # recovery after the blind window
check("not stranded: recovery still yields ONE info line", len(h.sent) == 1, repr(h.sent))
check("and it is the INFO one-liner", h.sent[0].startswith("\U0001F535 INFO") and "\n" not in h.sent[0],
      h.sent[0])

print("\n[5] a hold is BOUNDED — sustained UNKNOWN escalates instead of stranding")
h = fresh()
h.tick(DEAD)
h.tick(DEAD, DEAD)                 # HOLD
h.rec.sent.clear()
st = h.st                          # age the hold past the bound
old = datetime.now(timezone.utc) - timedelta(seconds=f.PENDING_MAX_HOLD_S + 60)
st["pending"]["since"] = old.strftime("%Y-%m-%dT%H:%M:%SZ")
h.state.write_text(json.dumps(st))
f.canary_ok = lambda: False
h.tick(UNRESOLVED)
check("expired hold escalates to a page", len(h.sent) == 1, repr(h.sent))
check("and it is BROKEN, not INFO", h.sent and h.sent[0].startswith("\U0001F6A8 BROKEN"), h.sent[:1])
check("it says WHY the verdict is unconfirmed",
      h.sent and "egress" in h.sent[0] and "cannot be re-checked" in h.sent[0], h.sent[:1])
check("hold released", h.st.get("pending") is None, repr(h.st.get("pending")))

print("\n[6] the dangerous heal outcomes are NEVER held (unchanged paths)")
h = fresh(run_ts=lambda args, timeout: (0, "") if "off" in args else (1, "bg boom"))
h.tick(DEAD)
h.tick(DEAD)                       # off ok, --bg fails twice -> left_off
check("left_off pages IMMEDIATELY, no hold", len(h.sent) == 1, repr(h.sent))
check("left_off is BROKEN severity", h.sent and h.sent[0].startswith("\U0001F6A8 BROKEN"), h.sent[:1])
check("left_off sets no pending", h.st.get("pending") is None, repr(h.st.get("pending")))
check("left_off warns the Funnel may be off",
      h.sent and "LEFT OFF" in h.sent[0], h.sent[:1])

h = fresh(run_ts=lambda args, timeout: (1, "boom"))
h.tick(DEAD)
h.tick(DEAD)                       # off fails AND --bg fails -> rearm_failed
check("rearm_failed pages IMMEDIATELY, no hold", len(h.sent) == 1, repr(h.sent))
check("rearm_failed is BROKEN severity", h.sent and h.sent[0].startswith("\U0001F6A8 BROKEN"), h.sent[:1])
check("rearm_failed sets no pending", h.st.get("pending") is None, repr(h.st.get("pending")))

print("\n[7] a CONFIRMED auto-heal is the same class -> one INFO line")
h = fresh()
h.tick(DEAD)
h.tick(DEAD, OK)                   # re-probe confirms the re-arm -> healed
check("healed posts exactly one message", len(h.sent) == 1, repr(h.sent))
check("healed is one INFO line",
      h.sent and h.sent[0].startswith("\U0001F535 INFO") and "\n" not in h.sent[0], h.sent[:1])
check("healed names the auto-heal", h.sent and "auto-heal revived it" in h.sent[0], h.sent[:1])

print("\n[8] a failed INFO delivery RETRIES instead of losing the notice")
h = fresh(recorder=FailingRecorder())
h.tick(DEAD)
h.tick(DEAD, DEAD)                 # HOLD
h.tick(OK)                         # info attempted, delivery fails
check("hold survives a failed delivery", bool(h.st.get("pending")), repr(h.st.get("pending")))
h.rec.__class__ = Recorder         # delivery comes back
h.tick(OK)
check("the notice is retried and lands", len(h.sent) == 2, f"{len(h.sent)}")
check("hold cleared once delivered", h.st.get("pending") is None, repr(h.st.get("pending")))

print("\n[9] the grace window and healthy ticks are still silent")
h = fresh()
for _ in range(4):
    h.tick(OK)
check("4 healthy ticks post nothing", h.sent == [], repr(h.sent))
h.tick(DEAD)
check("a single failed probe posts nothing", h.sent == [], repr(h.sent))

print("\n[10] _et_window never returns an empty or unlabelled 'when'")
check("normal window has both ends + zone", f._et_window("2026-08-08T20:29:14Z").count(":") == 2)
check("unrecorded start SAYS so", "(start unrecorded)" in f._et_window(None), f._et_window(None))
check("malformed start SAYS so", "(start unrecorded)" in f._et_window("not-a-time"),
      f._et_window("not-a-time"))
check("_age_s on a malformed stamp is 0 (cannot silently escalate)", f._age_s("nope") == 0.0)

print(f"\n{'=' * 70}\n{len(PASS)} passed, {len(FAIL)} failed, {len(PASS) + len(FAIL)} total")
if FAIL:
    for n in FAIL:
        print(f"  FAILED: {n}")
sys.exit(1 if FAIL else 0)
