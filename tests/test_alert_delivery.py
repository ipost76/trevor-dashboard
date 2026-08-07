#!/usr/bin/env python3
"""B6-ALERTS — proofs for the shared WSL alert ladder, its four callers, and the scrub.

🚨 NOT ONE DISCORD POST IS MADE BY THIS FILE. `requests.post` is replaced with a recorder
for the whole run, and every assertion is made against what the recorder CAPTURED. A test
that verifies a route by posting to the real channel is not a test, it is an outage
notification with extra steps.

Run: python3 tests/test_alert_delivery.py     (pytest is genuinely absent on this box —
                                               Law 4; this is a __main__ self-runner)
Exit: 0 all passed | 1 one or more failed
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))
sys.path.insert(0, str(REPO / "scripts" / "db"))

# ── containment: a fake webhook + a fake token, set BEFORE anything imports ──────────
# resolve_webhook() gives per-var precedence to the process env over .env.local, so these
# shadow the real values. HUB_QA is left UNSET so the resolver falls back exactly as it
# does in production today — that is the case tier 2 exists for.
FAKE_WEBHOOK = "https://discord.com/api/webhooks/999999999/FAKE-TEST-TOKEN-do-not-use"
os.environ.pop("HUB_QA_WEBHOOK_URL", None)
os.environ["HUB_DOWNLOADS_WEBHOOK_URL"] = FAKE_WEBHOOK
os.environ["DISCORD_BOT_TOKEN"] = "FAKE.BOT.TOKEN.for-tests-only-never-real"

import requests  # noqa: E402

import alert_delivery as ad  # noqa: E402

CHANNELS_URL = f"https://discord.com/api/v10/channels/{ad.QA_CHANNEL_ID}/messages"

_FAILS: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  ✓ {name}")
    else:
        _FAILS.append(name)
        print(f"  ✗ {name}" + (f"  --> {detail}" if detail else ""))


class FakeResp:
    def __init__(self, status_code: int, text: str = ""):
        self.status_code = status_code
        self.text = text

    def json(self):
        return json.loads(self.text or "{}")


class Recorder:
    """Stands in for requests.post. Returns queued outcomes; records every call."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.queue: list = []

    def __call__(self, url, json=None, headers=None, timeout=None, **kw):
        self.calls.append((url, json or {}))
        outcome = self.queue.pop(0) if self.queue else FakeResp(204)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    @property
    def urls(self):
        return [u for u, _ in self.calls]

    def body(self, i=0) -> str:
        payload = self.calls[i][1]
        return payload.get("content") or json.dumps(payload)


_real_post = requests.post
REC = Recorder()
requests.post = REC  # type: ignore[assignment]


def reset(*queue):
    REC.calls.clear()
    REC.queue = list(queue)
    return REC


# ── 1. the scrub — the credential-leak fix ───────────────────────────────────────────
def test_scrub():
    print("[1] scrub() strips the credential and keeps the diagnostic")
    # The EXACT shape sitting in this box's journal three times (2026-07-28, 07-29 x2).
    # 🚨 TWO DISTINCT SHAPES, AND THE SECOND IS THE ONE THAT ACTUALLY LEAKED. urllib3
    # prints the host separately and the PATH on its own, so the bare
    # `/api/webhooks/<id>/<token>` never matches an https:// pattern. The first draft of
    # this test built the fixture with BOTH shapes but only asserted on the full-URL half,
    # so it passed while the real leak sailed straight through — found by running the fix
    # against the actual journal. Both halves are asserted now.
    leaked = (f"HTTPSConnectionPool(host='discord.com', port=443): Max retries exceeded "
              f"with url: /api/webhooks/1512937685134606479/eik8AiZ7_S-kdJY8X42 "
              f"(Caused by SSLError(SSLEOFError(8, 'EOF')))")
    full = f"failed to post to {FAKE_WEBHOOK}: {leaked}"
    out = ad.scrub(full)
    check("full webhook URL removed", "FAKE-TEST-TOKEN-do-not-use" not in out, out)
    check("BARE webhook path removed (the shape urllib3 really emits)",
          "/api/webhooks/1512937685134606479" not in out, out)
    check("the bare path's TOKEN is gone", "eik8AiZ7_S-kdJY8X42" not in out, out)
    check("host preserved for diagnosis", "discord.com" in out, out)
    check("redaction marker present", "<redacted>" in out, out)
    check("bot token removed",
          "FAKE.BOT.TOKEN.for-tests-only-never-real" not in
          ad.scrub("Authorization: Bot FAKE.BOT.TOKEN.for-tests-only-never-real"))
    # NEGATIVE CONTROL: a string with no secret must survive intact, or "scrubbed" would
    # just mean "mangled" and the passing assertions above would prove nothing.
    plain = "unit=trevor-watcher.service is-active=failed exit code 1"
    check("negative control: clean text unchanged", ad.scrub(plain) == plain, ad.scrub(plain))


def test_describe_failure():
    print("[2] describe_failure() classifies transmission and never leaks")
    ct = requests.exceptions.ConnectTimeout(f"timed out connecting to {FAKE_WEBHOOK}")
    detail, sent = ad.describe_failure(ct)
    check("ConnectTimeout -> provably NOT transmitted", sent is False, repr(sent))
    check("ConnectTimeout detail is scrubbed", "FAKE-TEST-TOKEN-do-not-use" not in detail, detail)
    check("detail names the exception type", "ConnectTimeout" in detail, detail)
    check("detail carries no traceback", "Traceback" not in detail, detail)

    _, sent = ad.describe_failure(requests.exceptions.ReadTimeout("read timed out"))
    check("ReadTimeout -> transmitted, outcome UNKNOWN", sent is None, repr(sent))

    dns = requests.exceptions.ConnectionError(
        "NameResolutionError: Failed to resolve 'discord.com'")
    _, sent = ad.describe_failure(dns)
    check("DNS failure -> provably NOT transmitted", sent is False, repr(sent))


# ── 2. the ladder ────────────────────────────────────────────────────────────────────
def render_of(text="body"):
    return lambda label, note: {"content": f"{text} | sent to {label}" +
                                (f" | {note}" if note else "")}


def test_tier2_delivers_and_stops():
    print("[3] tier 2 delivers to #qa-agent and tier 3 does NOT also fire (double-post guard)")
    rec = reset(FakeResp(200))
    res = ad.post_alert(render_of(), source="t")
    check("delivered", res.ok and res.tier == 2, repr(res))
    check("exactly ONE HTTP call", len(rec.calls) == 1, str(rec.urls))
    check("it went to the #qa-agent channel endpoint", rec.urls == [CHANNELS_URL], str(rec.urls))
    check("body names the channel and mechanism", "#qa-agent (bot-token)" in rec.body(), rec.body())


def test_tier2_http_failure_falls_through():
    print("[4] a tier-2 HTTP refusal falls through to tier 3 — the alert is not lost")
    rec = reset(FakeResp(403, '{"message":"Missing Permissions"}'), FakeResp(204))
    res = ad.post_alert(render_of(), source="t")
    check("still delivered", res.ok and res.tier == 3, repr(res))
    check("two calls: channel then webhook",
          rec.urls == [CHANNELS_URL, FAKE_WEBHOOK], str(rec.urls))
    check("tier-3 copy carries NO duplicate warning (a 403 proves nothing was posted)",
          "possible duplicate" not in rec.body(1), rec.body(1))


def test_tier2_connect_failure_falls_through_clean():
    print("[5] a connect-stage failure falls through with no duplicate warning")
    rec = reset(requests.exceptions.ConnectTimeout("no route"), FakeResp(204))
    res = ad.post_alert(render_of(), source="t")
    check("delivered on tier 3", res.ok and res.tier == 3, repr(res))
    check("no duplicate warning — nothing was transmitted",
          "possible duplicate" not in rec.body(1), rec.body(1))


def test_tier2_unconfirmed_labels_the_duplicate():
    print("[6] an UNCONFIRMED tier 2 still falls through, and the copy SAYS it may be a dupe")
    rec = reset(requests.exceptions.ReadTimeout("read timed out"), FakeResp(204))
    res = ad.post_alert(render_of(), source="t")
    check("alert NOT lost — tier 3 fired", res.ok and res.tier == 3, repr(res))
    check("the second copy is labelled a possible duplicate",
          "possible duplicate" in rec.body(1), rec.body(1))
    check("the note explains why", "UNCONFIRMED" in rec.body(1), rec.body(1))


def test_tier1_short_circuits_bot():
    print("[7] with HUB_QA_WEBHOOK_URL present, tier 1 wins and the bot path is never tried")
    os.environ["HUB_QA_WEBHOOK_URL"] = "https://discord.com/api/webhooks/111/QA-FAKE"
    try:
        rec = reset(FakeResp(204))
        res = ad.post_alert(render_of(), source="t")
        check("delivered on tier 1", res.ok and res.tier == 1, repr(res))
        check("the bot endpoint was NOT called", CHANNELS_URL not in rec.urls, str(rec.urls))
    finally:
        os.environ.pop("HUB_QA_WEBHOOK_URL", None)


def test_total_failure_is_loud_not_silent():
    print("[8] when every tier fails the result is ok=False (the caller must go loud)")
    reset(FakeResp(500), FakeResp(500))
    res = ad.post_alert(render_of(), source="t")
    check("reports failure", res.ok is False, repr(res))


# ── 3. all four posters reach #qa-agent ──────────────────────────────────────────────
def test_all_four_posters_reach_qa():
    print("[9] ALL FOUR posters (+ the budget alert) resolve #qa-agent")
    import cost_alert_notify as cost
    import external_liveness_check as elc
    import funnel_edge_watch as few
    import watcher_alert as wa
    import watcher_arm_check as wac

    marker_dir = tempfile.mkdtemp(prefix="b6-markers-", dir="/home/ghost/tmp")
    os.environ["WATCHER_ALERT_MARKER_DIR"] = marker_dir

    cases = {
        "watcher_alert": lambda: wa.main(["watcher_alert.py", "trevor-watcher.service"]),
        "funnel_edge_watch": lambda: few.alert(
            few.down_heal_failed(2, "rc=7 http=000 ip=-", "off rc=0; --bg failed twice")),
        "watcher_arm_check": lambda: wac._post(wac.build_verdict(
            [("systemd", (False, "is-active=failed"))], False)),
        "external_liveness_check": lambda: elc._post(elc.build_alert(
            "trainer_heartbeat", "ok", "bad", ["unit=x is-active=failed"])),
        "cost_alert_notify": lambda: cost._deliver(
            cost._build_alert(240.0, 80.0, {"service": "Compute Engine", "net_usd": 190.0},
                              137.0, "August 2026", 244.0)),
    }
    bodies = {}
    for name, run in cases.items():
        rec = reset(FakeResp(200))
        run()
        went_to_qa = rec.urls[:1] == [CHANNELS_URL]
        check(f"{name} -> #qa-agent via bot-token", went_to_qa, str(rec.urls))
        if went_to_qa:
            bodies[name] = rec.body()
    return bodies


def test_file_delivery_untouched():
    print("[10] the FILE-delivery path still targets #downloads and is unchanged")
    src = (REPO / "scripts" / "discord_file_delivery.py").read_text()
    check("discord_file_delivery still reads HUB_DOWNLOADS_WEBHOOK_URL",
          "HUB_DOWNLOADS_WEBHOOK_URL" in src)
    check("discord_file_delivery does NOT import the alert ladder",
          "alert_delivery" not in src)
    dr = (REPO / "scripts" / "deliver_report.py").read_text()
    check("deliver_report does NOT import the alert ladder", "alert_delivery" not in dr)
    # 🚨 STRUCTURAL, NOT TEXTUAL. A grep for "_read_webhook_url" also matches the docstring
    # that EXPLAINS why the reader was dropped — the first draft of this test failed on its
    # own prose. Assert against the parsed import graph, which cannot be tripped by a
    # comment and cannot be satisfied by deleting one.
    import ast

    cost_src = (REPO / "scripts" / "db" / "cost_alert_notify.py").read_text()
    tree = ast.parse(cost_src)
    imported, called = set(), set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module)
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            called.add(node.func.attr)
    check("cost_alert_notify no longer IMPORTS the downloads-only sender",
          "discord_file_delivery" not in imported, str(sorted(imported)))
    check("cost_alert_notify never CALLS _read_webhook_url",
          "_read_webhook_url" not in called, str(sorted(called)))
    check("cost_alert_notify imports the shared ladder instead",
          "alert_delivery" in imported, str(sorted(imported)))


def test_rate_limit_still_fails_open():
    print("[11] watcher_alert._rate_limited still FAILS OPEN, and the ladder has no limiter")
    import watcher_alert as wa

    d = tempfile.mkdtemp(prefix="b6-rl-", dir="/home/ghost/tmp")
    os.environ["WATCHER_ALERT_MARKER_DIR"] = d
    check("absent marker -> not limited", wa._rate_limited("u.service", 1000.0) is False)
    Path(d, "u.service.ts").write_text("not-a-float\n")
    check("CORRUPT marker -> not limited (fails OPEN)",
          wa._rate_limited("u.service", 1000.0) is False)
    Path(d, "u.service.ts").write_text("999.0\n")
    check("fresh marker -> limited (positive control: it really does suppress)",
          wa._rate_limited("u.service", 1000.0) is True)
    check("the SHARED ladder carries no rate limit",
          "rate" not in (ad.post_alert.__doc__ or "").lower() and
          not hasattr(ad, "_rate_limited"))


# ── 4. the house shape ───────────────────────────────────────────────────────────────
def test_house_shape(bodies: dict):
    print("[12] every poster's output obeys the house shape")
    for name, body in sorted(bodies.items()):
        lines = body.splitlines()
        print(f"      {name}: {len(lines)} lines / {len(body)} chars")
        check(f"{name} <= {ad.MAX_LINES} lines", len(lines) <= ad.MAX_LINES, str(len(lines)))
        check(f"{name} <= {ad.MAX_CHARS} chars", len(body) <= ad.MAX_CHARS, str(len(body)))
        check(f"{name} names the box", f"({ad.BOX})" in body, lines[0] if lines else "")
        check(f"{name} stamps ET",
              any(z in body for z in ("EDT", "EST")), lines[-1] if lines else "")
        check(f"{name} carries one of the four severities",
              any(w in lines[0] for w in ("BROKEN", "DEGRADED", "INFO", "RECOVERED")),
              lines[0] if lines else "")
        check(f"{name} has no raw dict", "{'" not in body and '{"' not in body, name)
        check(f"{name} has no code fence", "```" not in body, name)
        check(f"{name} has no traceback", "Traceback" not in body, name)
        check(f"{name} leaks no webhook URL", "FAKE-TEST-TOKEN-do-not-use" not in body, name)


def test_truncation_is_visible():
    print("[13] over-long content is cut and the cut is VISIBLE")
    long_fact = "x" * 4000
    out = ad.house_alert(ad.SEV_BROKEN, "headline", [long_fact, long_fact],
                         "meaning", "src", stamp="2026-08-06 11:42 PM EDT")
    check("within the char cap", len(out) <= ad.MAX_CHARS, str(len(out)))
    check("within the line cap", len(out.splitlines()) <= ad.MAX_LINES)
    check("the cut is announced", "[clipped]" in out or "[TRUNCATED]" in out, out[-80:])
    check("the frame survives the cut — stamp intact", "11:42 PM EDT" in out, out[-80:])
    many = ad.house_alert(ad.SEV_INFO, "h", [f"fact{i}" for i in range(9)], "m", "s")
    check("extra fact lines are counted, not silently dropped",
          "more not shown" in many, many)


def test_journal_selection():
    print("[14] the 3-line journal tail finds the error, and is scrubbed")
    import watcher_alert as wa

    noisy = ["    rsync: sent 292,599 bytes  received 10,705,508 bytes",
             "    rsync: total size is 1,746,083,840  speedup is 158.76",
             "tailsync: staged auto_trades MAX(id)=101782",
             "tailsync: ERROR could not open trevor.db: permission denied",
             "    rsync: total size is 1,746,288,640  speedup is 145.93",
             "tailsync: published fresh replica -> done."]
    wa._run = lambda args, timeout: "\n".join(noisy)  # type: ignore[assignment]
    facts = wa.journal_facts("trevor-tailsync.service")
    joined = " ".join(facts)
    check("<= JOURNAL_LINES lines", len(facts) <= wa.JOURNAL_LINES, str(len(facts)))
    check("JOURNAL_LINES trimmed from 15", wa.JOURNAL_LINES < 15, str(wa.JOURNAL_LINES))
    check("the ERROR line is selected out of the rsync noise",
          "permission denied" in joined, joined)
    check("rsync byte-count noise is NOT what got shown", "speedup is" not in joined, joined)

    wa._run = lambda args, timeout: f"boom: posting to {FAKE_WEBHOOK} failed"  # type: ignore
    check("a webhook URL in the journal is SCRUBBED before it is posted back to Discord",
          "FAKE-TEST-TOKEN-do-not-use" not in " ".join(
              wa.journal_facts("x.service")))


def main() -> int:
    print("=== B6-ALERTS: shared alert ladder ===")
    print(f"box={ad.BOX}  qa_channel={ad.QA_CHANNEL_ID}  stamp={ad.et_stamp()}\n")
    try:
        test_scrub()
        test_describe_failure()
        test_tier2_delivers_and_stops()
        test_tier2_http_failure_falls_through()
        test_tier2_connect_failure_falls_through_clean()
        test_tier2_unconfirmed_labels_the_duplicate()
        test_tier1_short_circuits_bot()
        test_total_failure_is_loud_not_silent()
        bodies = test_all_four_posters_reach_qa()
        test_file_delivery_untouched()
        test_rate_limit_still_fails_open()
        test_house_shape(bodies)
        test_truncation_is_visible()
        test_journal_selection()
    finally:
        requests.post = _real_post  # type: ignore[assignment]

    print(f"\n=== {'FAILED: ' + ', '.join(_FAILS) if _FAILS else 'ALL PASSED'} ===")
    return 1 if _FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
