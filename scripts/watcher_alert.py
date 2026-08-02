#!/usr/bin/env python3
"""RF2-C1 — WSL-local death-alert handler for the TREVOR oversight daemons.

Fired by systemd ``OnFailure=trevor-alert@%n.service`` when a monitored unit
reaches ``failed`` (a *sustained* crash — ``Restart=on-failure`` retries first,
so a single crash-and-recover fires NOTHING; only exhausting StartLimitBurst
gets here). Posts the failure to Discord and STATES which channel it landed in.

Why this file exists — the silent-lifecycle-failure class this whole prompt kills:
  * EXPLICIT User-Agent on the POST. ``urllib``'s default UA gets Cloudflare-403'd;
    ``requests``' default passes, but we set one anyway — belt-and-suspenders + the
    C1 mandate (measured: no-UA urllib -> 403, with-UA -> 204).
  * WSL-LOCAL transport (WSL -> Discord over the internet), NOT WSL -> VM over the
    tailnet — which is exactly why it survives an unreachable-VM case. The VM-side
    RF3T1-B2 alert handler is VM-only with no VM->WSL path, so it cannot see these
    daemons; this handler can.
  * RATE-LIMIT: at most one post per unit per ALERT_INTERVAL_SEC (default 600s) via a
    marker file — a flapping unit cannot storm the channel. A rate-limited skip is
    LOGGED, never silent.
  * NO recursion: the ``trevor-alert@`` template carries NO ``OnFailure=`` of its own.
  * FAIL LOUD: any failure (import / resolve / non-2xx / exception) prints to stderr ->
    the handler's OWN journal, and does NOT record the marker (so the next failure of the
    same unit retries). A silent alert handler is the failure this prompt exists to end.

DELIVERY IS THREE-TIERED (B4-HUB-RESILIENCE, 2026-08-02). In priority order:
  1. HUB_QA_WEBHOOK_URL webhook -> #qa-agent   (preferred: lowest blast radius, no token)
  2. bot-token REST            -> #qa-agent   (the live path today)
  3. HUB_DOWNLOADS_WEBHOOK_URL -> #downloads  (LAST RESORT, never silently preferred)

🚨 WHY TIER 2 EXISTS. Webhook resolution reuses ``funnel_edge_watch.resolve_webhook()``,
which prefers HUB_QA_WEBHOOK_URL and falls back to HUB_DOWNLOADS_WEBHOOK_URL. Measured
2026-07-24 and RE-MEASURED 2026-08-02: HUB_QA_WEBHOOK_URL is ABSENT from .env.local, so
every SERVICE-DEATH page landed in #downloads -- the artifact-delivery channel. A daemon
death notice arriving at 00:12 AM among report drops is structurally indistinguishable
from a report drop, which is the same silent-lifecycle failure this handler exists to end.
The obvious fix, "mint the #qa-agent webhook", IS NOT ACTIONABLE: the bot lacks Manage
Webhooks on #qa-agent (403), so that step has been open and un-takeable since 2026-07-14.
Tier 2 routes around it with the pattern the VM's hub_health_monitor.py has used
successfully all along -- a bot-token REST POST to the channel. No webhook needed.
🚨 .env.local IS NOT EDITED BY THIS FILE OR ANY PROMPT (CLAUDE.md: minting is Ghost-side).
Tier 1 stays PRIMARY: the moment Ghost sets HUB_QA_WEBHOOK_URL, tier 2 is bypassed with
no code change. The alert body always states the channel AND the mechanism it used.

Honest blind spot: a total WSL->internet outage defeats any webhook. Stated, not hidden.

Usage:  watcher_alert.py <failed-unit-name>      (systemd passes %i = the failed unit)
Env (testing only):
  WATCHER_ALERT_DRY_RUN=1        build + resolve + print, do NOT post, do NOT mark
  WATCHER_ALERT_MARKER_DIR=DIR   override the rate-limit marker dir (keep the real one clean)
  WATCHER_ALERT_INTERVAL_SEC=N   override the rate-limit window
Exit: 0 posted / dry-run / rate-limited (deliberate)  |  1 post failed (loud)  |  2 usage
"""
from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# The scripts dir is on sys.path[0] when run as `python3 scripts/watcher_alert.py`,
# but pin it so `import funnel_edge_watch` resolves regardless of cwd.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

REPO = _HERE.parent
DEFAULT_MARKER_DIR = REPO / "data" / ".alert_markers"
ALERT_INTERVAL_SEC = int(os.environ.get("WATCHER_ALERT_INTERVAL_SEC", "600"))
USER_AGENT = "trevor-watcher-alert/1 (RF2-C1)"
JOURNAL_LINES = 15
_MAX_CONTENT = 1900  # Discord hard-caps a message at 2000 chars; leave headroom.

# B4-HUB-RESILIENCE: the tier-2 bot-token path. Channel id matches the VM monitor's
# HUB_MONITOR_QA_CHANNEL_ID (#qa-agent) -- the same channel, reached the same way.
QA_CHANNEL_ID = os.environ.get("WATCHER_ALERT_QA_CHANNEL_ID", "1479969192139690029")
BOT_TOKEN_VAR = "DISCORD_BOT_TOKEN"


def _loud(msg: str) -> None:
    """Everything the handler says goes to stderr -> its own systemd journal."""
    print(f"[watcher_alert] {msg}", file=sys.stderr, flush=True)


def _marker_path(unit: str) -> Path:
    mdir = Path(os.environ.get("WATCHER_ALERT_MARKER_DIR", str(DEFAULT_MARKER_DIR)))
    safe = unit.replace("/", "_")
    return mdir / f"{safe}.ts"


def _rate_limited(unit: str, now: float) -> bool:
    """True if we posted for this unit within ALERT_INTERVAL_SEC. Fails OPEN (never
    suppresses a real alert on a marker read error)."""
    mp = _marker_path(unit)
    try:
        last = float(mp.read_text().strip())
    except (OSError, ValueError):
        return False
    return (now - last) < ALERT_INTERVAL_SEC


def _record_marker(unit: str, now: float) -> None:
    mp = _marker_path(unit)
    try:
        mp.parent.mkdir(parents=True, exist_ok=True)
        tmp = mp.with_suffix(".ts.tmp")
        tmp.write_text(f"{now}\n")
        tmp.replace(mp)
    except OSError as exc:  # a marker-write failure must not swallow a successful post
        _loud(f"WARNING: could not record rate-limit marker for {unit}: {exc}")


def _run(args: list[str], timeout: int) -> str:
    """Best-effort subprocess text; never raises (a diagnostic gatherer must not crash
    the alert). Returns '' on any failure."""
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return (p.stdout or "").strip()
    except Exception as exc:  # noqa: BLE001 - diagnostics are best-effort by design
        _loud(f"note: `{' '.join(args)}` failed: {exc}")
        return ""


def _unit_status(unit: str) -> str:
    out = _run(["systemctl", "show", unit,
                "--property=ActiveState,SubState,Result,ExecMainStatus,ExecMainCode,NRestarts",
                "--no-pager"], timeout=10)
    return out or "(systemctl status unavailable)"


def _unit_journal(unit: str) -> str:
    out = _run(["journalctl", "-u", unit, "-n", str(JOURNAL_LINES),
                "--no-pager", "-o", "cat"], timeout=10)
    return out or "(journal unavailable)"


def _read_bot_token() -> str:
    """DISCORD_BOT_TOKEN from the process env, else .env.local. '' when unavailable.

    🚨 NEVER logged, never returned to a printing caller, never put in an alert body.
    The unit carries EnvironmentFile=.env.local, so under systemd this normally hits
    the env branch; the file read is the fallback for a hand-run invocation."""
    val = os.environ.get(BOT_TOKEN_VAR, "").strip()
    if val:
        return val
    try:
        for line in (REPO / ".env.local").read_text().splitlines():
            if line.startswith(BOT_TOKEN_VAR + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


def _post_bot_channel(channel_id: str, content: str) -> tuple[bool, object, str]:
    """Tier 2 — POST one message to a channel with the bot token.

    Returns (ok, http_code, detail). Never raises, never logs the token. `detail` is a
    short Discord error snippet; Discord echoes the request body, not the auth header,
    so it is safe to log."""
    token = _read_bot_token()
    if not token:
        return False, None, f"{BOT_TOKEN_VAR} unavailable"
    try:
        import requests  # type: ignore
        resp = requests.post(
            f"https://discord.com/api/v10/channels/{channel_id}/messages",
            json={"content": content},
            headers={"Authorization": f"Bot {token}", "User-Agent": USER_AGENT},
            timeout=15,
        )
    except Exception as exc:  # noqa: BLE001 - a WSL->internet outage lands here; be LOUD
        return False, None, f"{type(exc).__name__}: {exc}"
    if resp.status_code in (200, 201, 204):
        return True, resp.status_code, ""
    return False, resp.status_code, (resp.text or "")[:200]


def _channel_label(varname: str, qa_var: str, via_bot: bool = False) -> str:
    if via_bot:
        return "#qa-agent (bot-token REST — the #qa-agent webhook mint is perm-blocked)"
    if varname == qa_var:
        return "#qa-agent (HUB_QA_WEBHOOK_URL)"
    return ("#downloads (HUB_DOWNLOADS_WEBHOOK_URL — LAST RESORT; both the #qa-agent "
            "webhook and the bot-token path were unavailable)")


def build_message(unit: str, stamp: str, status: str, journal: str, channel_label: str) -> str:
    body = (
        f"\U0001F6A8 **TREVOR daemon FAILED** — `{unit}`\n"
        f"time: `{stamp}`\n"
        f"delivered to: {channel_label}\n"
        f"```\n{status}\n```\n"
        f"last {JOURNAL_LINES} journal line(s):\n"
        f"```\n{journal}\n```"
    )
    if len(body) > _MAX_CONTENT:
        body = body[: _MAX_CONTENT - 3] + "..."
    return body


def main(argv: list[str]) -> int:
    if len(argv) < 2 or not argv[1].strip():
        _loud("USAGE: watcher_alert.py <failed-unit-name> (systemd passes %i). No unit given.")
        return 2
    unit = argv[1].strip()
    now = datetime.now().timestamp()
    dry = os.environ.get("WATCHER_ALERT_DRY_RUN") == "1"

    if _rate_limited(unit, now):
        _loud(f"RATE-LIMITED: an alert for {unit} posted <{ALERT_INTERVAL_SEC}s ago — skipping "
              f"(deliberate; a flapping unit must not storm the channel).")
        return 0

    stamp = datetime.now().astimezone().isoformat(timespec="seconds")
    status = _unit_status(unit)
    journal = _unit_journal(unit)

    # Resolve the webhook — reuse the proven funnel_edge_watch resolver. A resolve/import
    # failure is LOUD (the whole point of this handler is that its failure is visible).
    try:
        from funnel_edge_watch import QA_ENV_VAR, resolve_webhook  # type: ignore
        url, varname = resolve_webhook()
    except Exception as exc:  # noqa: BLE001 - resolve failure MUST be loud, never silent
        _loud(f"FAILED to resolve a webhook for {unit}'s death alert: {exc}. "
              f"Alert NOT sent — a human must see this line. Not recording a marker (will retry).")
        return 1

    # ── delivery tier selection (B4-HUB-RESILIENCE) ─────────────────────────
    # Tier 1 (the QA webhook) wins whenever it resolves. Tier 2 is tried only when the
    # resolver FELL BACK to #downloads, i.e. exactly the case that used to misroute a
    # service-death page into the artifact channel. Tier 3 is what tier 2 falls through
    # to, so the alert can never be LOST by adding a tier -- only re-routed.
    use_bot = varname != QA_ENV_VAR and bool(_read_bot_token())
    channel_label = _channel_label(varname, QA_ENV_VAR, via_bot=use_bot)
    msg = build_message(unit, stamp, status, journal, channel_label)

    if dry:
        _loud(f"DRY_RUN: would POST to {channel_label} ({varname}); not posting, not marking.")
        print(msg)
        return 0

    if use_bot:
        ok, code, detail = _post_bot_channel(QA_CHANNEL_ID, msg)
        if ok:
            _loud(f"POSTED {unit}'s death alert to {channel_label} (HTTP {code}).")
            _record_marker(unit, now)
            return 0
        # Do NOT return here -- fall through to the webhook so a token problem
        # degrades to the old behaviour instead of silencing the alert entirely.
        _loud(f"tier-2 bot-token post to #qa-agent FAILED (HTTP {code} {detail!r}) — "
              f"falling back to the {varname} webhook so the alert is not lost.")
        channel_label = _channel_label(varname, QA_ENV_VAR, via_bot=False)
        msg = build_message(unit, stamp, status, journal, channel_label)

    try:
        import requests  # type: ignore
        resp = requests.post(
            url,
            json={"content": msg},
            headers={"User-Agent": USER_AGENT},  # EXPLICIT UA (the C1 mandate)
            timeout=15,
        )
    except Exception as exc:  # noqa: BLE001 - a WSL->internet outage lands here; be LOUD
        _loud(f"FAILED to POST {unit}'s death alert to {channel_label}: {exc}. "
              f"Alert NOT delivered. Not recording a marker (will retry on the next failure).")
        return 1

    if resp.status_code in (200, 204):
        _loud(f"POSTED {unit}'s death alert to {channel_label} (HTTP {resp.status_code}).")
        _record_marker(unit, now)
        return 0

    snippet = (resp.text or "")[:300]
    _loud(f"FAILED to deliver {unit}'s death alert to {channel_label}: HTTP {resp.status_code} "
          f"{snippet!r}. Not recording a marker (will retry).")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
