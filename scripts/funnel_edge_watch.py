#!/usr/bin/env python3
"""TREVOR Hub — Funnel edge-health watch + auto-heal  [FUNNEL-B1 / B1-FUNNEL-HEAL]

Probes the PUBLIC Tailscale Funnel edge the way an outside client reaches it:
the Hub hostname is resolved via Google DoH (never the box resolver — MagicDNS
would short-circuit to the tailnet IP and self-test the box, which stayed green
through the Jun 30 edge death). HEALTHY requires an HTTP 2xx/3xx AND the
connection landing on a public edge IP, not this node's own tailnet address.

On a confirmed DEAD edge (>= FAILS_TO_ALERT consecutive fails, egress canary OK)
the watch AUTO-HEALS: it toggles the Funnel off then re-arms it
(`tailscale funnel --https=443 off && … --bg --https=443 3000` — the proven
revive), re-probes, and reports what actually happened — instead of only
alerting. Capped at HEAL_CAP attempts per incident (counter on disk, survives
restart); the counter resets on recovery. The heal NEVER leaves the Funnel off:
a --bg failure after a successful off fires the loudest alert with the exact
manual re-arm command. Every subprocess is hard-timeout'd and the heal path is
budgeted so it can never approach the unit's TimeoutStartSec (systemd never
SIGTERMs us mid-heal).

Alerts resolve the webhook in order: HUB_QA_WEBHOOK_URL (#qa-agent) if set, else
HUB_DOWNLOADS_WEBHOOK_URL (both from .env.local, never hardcoded/printed). The
resolved target VARNAME is logged once per run (webhook_target=…) — never the
URL. Alerts on STATE CHANGE only: 🚨 when the edge goes dead / auto-heal fails,
✅ on recovery. Silent while healthy. A failed probe with a failed egress canary
classifies as UNKNOWN (this box's internet, not the edge) — logged, never
alerted, state untouched, never healed.

🚨 THE ONE-TICK HOLD  [B4-PROOF, 2026-08-09]
A self-recovering edge posts ONCE, as ONE 🔵 INFO line — it is never silenced.

WHY THE OLD SHAPE WAS NOT MERELY NOISY, IT WAS FALSE. `heal()` re-arms the
Funnel and then re-probes within REPROBE_MAX_TIME_S (8s), while tailscaled needs
~2.5 min to re-stabilise the Funnel after `--bg` (CLAUDE.md, "WSL Hub Access").
So a `rearmed_still_dead` verdict is structurally unreachable in the affirmative:
the re-probe CANNOT see a successful re-arm. Measured over 2026-08-01..09 (777
probe runs): every one of the 3 incidents that alerted recorded
`last_heal_outcome=rearmed_still_dead` with BOTH tailscale calls rc=0, and every
one read HEALTHY on the very next tick (gaps 15.2 / 16.0 / 15.5 min — one timer
interval). The alert said "auto-heal did NOT fix it" on evidence that only
supported "not yet observable", then a ✅ landed 15 min later: 6 posts, 10 lines
and 1121 chars to describe an edge that fixed itself three times.

THE RULE. When the heal RE-ARMED CLEANLY (`rearmed_still_dead` /
`rearmed_unconfirmed` — both mean `off` and `--bg` returned rc=0 and only the
re-probe is unconfirmed) the BROKEN alert is HELD for exactly ONE probe cycle,
recorded in state as `pending`. The next tick decides:
    HEALTHY  -> ONE 🔵 INFO line naming the window and that it self-cleared
    DEAD     -> the full 🚨 BROKEN page, revive command intact (now CONFIRMED:
                the edge is still down a cycle after a successful re-arm)
    UNKNOWN  -> HOLD. Not cleared, not posted — this box's egress is down, so the
                edge verdict is unknowable and neither answer would be honest.
                Bounded by PENDING_MAX_HOLD_S so an incident can never strand.

🚨 NOTHING ELSE IS DEFERRED. `left_off` (the Funnel may be OFF), `rearm_failed`
(the re-arm itself failed) and `down_heal_skipped` (heal cap / no time budget)
page IMMEDIATELY at full severity, exactly as before. The cost of the hold is
stated plainly: a sustained outage pages ~15 min later, and ONLY in the case
where the auto-heal reported a clean re-arm.

State: data/funnel-edge-status.json (data/ is gitignored). Driven by
trevor-funnel-watch.timer every 15 min. Always exits 0 unless it crashes.

Test hooks (install verification only — not used by the timer):
  FUNNEL_WATCH_RESOLVE=host:443:ip   pin the probe target instead of DoH
  FUNNEL_WATCH_STATE=/path           alternate state file
  FUNNEL_WATCH_DRY_RUN=1             log the would-be alert, don't POST
  FUNNEL_WATCH_NO_HEAL=1             skip the real tailscale toggle (heal no-op)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# NOTE: `requests` is no longer imported here. Every POST this script makes now goes
# through scripts/alert_delivery.py, which owns the HTTP client, the explicit User-Agent
# (Discord's Cloudflare 403s urllib's default UA; requests passes) and the scrubbing.

REPO = Path(__file__).resolve().parent.parent
URL = "https://trevorhub-wsl.tail2bf7a3.ts.net/"
DOH_URL = "https://dns.google/dns-query"
CANARY_URL = "https://dns.google/"
SELF_IPS = {"100.113.60.59", "fd7a:115c:a1e0::4234:3c3c"}
STATE_FILE = Path(os.environ.get("FUNNEL_WATCH_STATE") or REPO / "data" / "funnel-edge-status.json")
FAILS_TO_ALERT = 2

# Webhook resolution order — prefer #qa-agent, fall back to #downloads. NEVER
# repoint HUB_DOWNLOADS_WEBHOOK_URL's value (shared by 3 other senders); this
# script only adds HUB_QA_WEBHOOK_URL and changes its own resolution. Byte-
# identical to today until Ghost adds HUB_QA_WEBHOOK_URL to .env.local — then
# it flips to #qa-agent on the next tick, no code change / no restart.
QA_ENV_VAR = "HUB_QA_WEBHOOK_URL"
FALLBACK_ENV_VAR = "HUB_DOWNLOADS_WEBHOOK_URL"

# Auto-heal budget. The heal path (off + --bg + one --bg retry + re-probe) is
# bounded so its worst case stays far under the unit's TimeoutStartSec=2min, and
# a deadline gate refuses to START `off` unless there is guaranteed time to
# finish `--bg` (+retry) + alert within budget — so systemd cannot SIGTERM us
# between off and --bg (which would leave the Funnel dark).
TAILSCALE = "/usr/local/bin/tailscale"      # on sudo's secure_path; hardcoded to dodge PATH surprises
HEAL_CAP = 2                                 # max heal attempts per incident
HEAL_STEP_TIMEOUT_S = 10                     # hard timeout per tailscale call
ONESHOT_BUDGET_S = 120                       # == unit TimeoutStartSec=2min
POST_RESERVE_S = 20                          # reserve for the alert POST (requests timeout=15) + save_state
DANGER_WINDOW_S = 3 * HEAL_STEP_TIMEOUT_S    # off + --bg + one --bg retry = 30s (the "must not be SIGTERM'd" span)
HEAL_START_DEADLINE_S = ONESHOT_BUDGET_S - POST_RESERVE_S - DANGER_WINDOW_S  # 70s: latest we may START `off`
REPROBE_MIN_S = 5                            # need >= this much budget left to bother re-probing
REPROBE_MAX_TIME_S = 8                       # cap the re-probe curl --max-time

REVIVE_CMD = "`sudo tailscale funnel --https=443 off && sudo tailscale funnel --bg --https=443 3000`"
HOST = "trevorhub-wsl.tail2bf7a3.ts.net"  # bare host, never a full URL — see _house() below

# The ONLY two heal outcomes whose BROKEN alert is held for one cycle. Both mean the
# tailscale calls returned rc=0 (the edge IS armed) and only the re-probe is unconfirmed
# — see the "ONE-TICK HOLD" block in the module docstring. Everything else pages now.
_HOLD_OUTCOMES = ("rearmed_still_dead", "rearmed_unconfirmed")
# 🚨 A HOLD MUST NEVER BECOME A STRANDED INCIDENT. Only a repeated UNKNOWN verdict can
# linger (a DEAD tick escalates, a HEALTHY tick posts the INFO line), and UNKNOWN means
# this box's own egress is down. Past this bound the held incident is reported at full
# severity naming exactly that, rather than waiting for a verdict that may never come.
# ~4 probe cycles at the unit's OnUnitActiveSec=15min.
PENDING_MAX_HOLD_S = 3600


def _loud(msg: str) -> None:
    print(f"[funnel_edge_watch] {msg}", file=sys.stderr, flush=True)


def _scrub(value: object) -> str:
    """Redact credentials from any text bound for a log or an alert body.

    🚨 NEVER print a raw exception from `requests`: it embeds the full request URL, and a
    Discord webhook URL IS the credential. This box's journal already carries a leaked
    HUB_DOWNLOADS_WEBHOOK_URL from exactly that path (2026-07-28, 2026-07-29 x2).
    """
    from alert_delivery import scrub  # type: ignore

    return scrub(value)


def _house(severity, headline: str, facts, meaning: str):
    """Build a house-shaped alert BUILDER: (channel_label, note) -> content string.

    A builder rather than a string so the body can state the channel AND mechanism it
    actually travelled by, and so a possible-duplicate note can be folded into the
    tier-3 copy. Every interpolated value is SCRUBBED: curl/tailscale stderr is echoed
    into these bodies, and an unscrubbed echo is how a credential reaches a channel.
    """
    from alert_delivery import house_alert, scrub  # type: ignore

    def build(channel_label: str, note: str | None) -> str:
        f = [scrub(x) for x in facts if x]
        if note:
            f.append(note)
        return house_alert(severity, headline, f, meaning,
                           f"funnel_edge_watch · sent to {channel_label}")

    return build


def _et(iso: str | None = None):
    """(datetime in ET, zone-abbrev). Never raises; degrades to UTC, never to empty.

    Mirrors alert_delivery.et_stamp's discipline: a missing timestamp reads as
    "unknown when", so a tzdata failure must still yield a present, labelled time.
    """
    try:
        from zoneinfo import ZoneInfo

        tz = ZoneInfo("America/New_York")
    except Exception:  # noqa: BLE001 - a tz lookup must never break an alert
        tz = timezone.utc
    if iso:
        try:
            base = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            return None, ""
    else:
        base = datetime.now(timezone.utc)
    dt = base.astimezone(tz)
    return dt, (dt.strftime("%Z") or "UTC")


def _et_hm(iso: str | None) -> str:
    """'16:45 EDT' for one instant. '' when the instant is unrecorded/unparseable."""
    dt, zone = _et(iso)
    return f"{dt:%H:%M} {zone}" if dt else ""


def _et_window(since_iso: str | None) -> str:
    """'16:29–17:01 EDT' — the incident window, ET, DST-aware. Never empty.

    An unrecorded start is SAID so rather than guessed at or silently dropped: the whole
    point of the one line is to say what happened and WHEN.
    """
    end, zone = _et(None)
    start, _ = _et(since_iso) if since_iso else (None, "")
    if start is None:
        return f"(start unrecorded)–{end:%H:%M} {zone}"
    return f"{start:%H:%M}–{end:%H:%M} {zone}"


def _age_s(iso: str | None) -> float:
    """Seconds since an ISO-Z stamp. 0.0 when unrecorded — an unknown age never
    trips a bound, so a malformed stamp cannot silently escalate an incident."""
    if not iso:
        return 0.0
    try:
        then = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, (datetime.now(timezone.utc) - then).total_seconds())


def _dedupe_err(detail: str, hdetail: str) -> str:
    """🚨 NEVER PRINT THE SAME ERROR PAYLOAD TWICE IN ONE MESSAGE.

    The probe detail and the post-heal re-probe detail both end in `err=<curl text>`, and
    on a flapping edge it is the SAME text — Ghost read that wall on a phone. When they
    match, the second copy is replaced by a back-reference. When they DIFFER, both are
    kept in full: two distinct errors are two facts, and collapsing them would hide one.
    """
    marker = " err="
    i = detail.find(marker)
    j = hdetail.find(marker)
    if i < 0 or j < 0:
        return hdetail
    if detail[i + len(marker):].strip() != hdetail[j + len(marker):].strip():
        return hdetail
    return hdetail[:j] + " err=(same as above)"


def down_heal_failed(fails, detail, hdetail, held_since=None):
    from alert_delivery import SEV_BROKEN  # type: ignore
    facts = [f"probe: {fails} consecutive failures · {detail}",
             f"auto-heal ran and did NOT fix it: {_dedupe_err(detail, hdetail)}"]
    held = _et_hm(held_since) if held_since else ""
    if held:
        # Only set on the ESCALATION path, where "did not fix it" is no longer an
        # inference from an 8s re-probe but an observation a full cycle later.
        facts.append(f"held since {held} and re-checked a full probe cycle later — "
                     f"still down, so this is not a flap")
    facts.append("the box and the tailnet path are likely fine — this is the public edge leg")
    return _house(SEV_BROKEN, "the public Hub Funnel edge is DOWN and auto-heal did not fix it",
                  facts,
                  f"{HOST} is unreachable from outside. Revive on WSL: {REVIVE_CMD}")


def down_heal_skipped(fails, detail, reason):
    from alert_delivery import SEV_BROKEN  # type: ignore
    return _house(SEV_BROKEN, "the public Hub Funnel edge is DOWN (auto-heal skipped this tick)",
                  [f"probe: {fails} consecutive failures · {detail}",
                   f"auto-heal skipped: {reason}",
                   "the box and the tailnet path are likely fine — this is the public edge leg"],
                  f"{HOST} is unreachable from outside. Revive on WSL: {REVIVE_CMD}")


def flapped(since_iso, what: str):
    """🔵 INFO — a self-recovering edge, in STRICTLY ONE LINE. SHORTEN, NEVER SILENCE.

    Replaces the 🚨-then-✅ pair (10 lines / 1121 chars) for the transient case. It still
    says WHAT happened and WHEN, names the box, carries an ET stamp and a severity from
    the house four — it is a smaller alert, not a missing one.

    🚨 The one-line guarantee is STRUCTURAL, not conventional: the assembled text is run
    through `.split()`/join, so a newline reaching it from a scrubbed payload collapses
    instead of quietly turning a one-line contract into a two-line message.
    """
    from alert_delivery import MAX_CHARS, SEV_INFO, BOX, scrub  # type: ignore

    icon, word = SEV_INFO
    window = _et_window(since_iso)

    def build(channel_label: str, note: str | None) -> str:
        line = (f"{icon} {word} — the public Hub Funnel edge flapped {window} and {what} · "
                f"funnel_edge_watch → {channel_label} ({BOX})")
        if note:
            line = f"{line} · {note}"
        line = " ".join(scrub(line).split())
        if len(line) > MAX_CHARS:
            line = line[: MAX_CHARS - 10].rstrip() + "…[clipped]"
        return line

    return build


def left_off(fails, detail):
    from alert_delivery import SEV_BROKEN  # type: ignore
    return _house(SEV_BROKEN, "the Hub Funnel may be LEFT OFF — the public Hub is DOWN right now",
                  ["auto-heal turned the Funnel OFF but could not turn it back ON",
                   f"{fails} consecutive dead checks · {detail}"],
                  f"{HOST} may be fully unreachable NOW. Re-arm on WSL IMMEDIATELY: {REVIVE_CMD}")


def recovered(detail):
    from alert_delivery import SEV_RECOVERED  # type: ignore
    return _house(SEV_RECOVERED, "the public Hub Funnel edge is serving again",
                  [str(detail)], f"{HOST} is reachable from outside. No action needed.")


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def probe(max_time: int = 20, subproc_timeout: int = 60) -> tuple[int, str, str, str]:
    """One external fetch of the Hub URL. Returns (curl_rc, http_code, remote_ip, err).
    Defaults reproduce the original probe exactly; the heal's fast re-probe passes tighter bounds."""
    resolve = os.environ.get("FUNNEL_WATCH_RESOLVE")
    cmd = ["curl", "-sS", "-o", "/dev/null", "--max-time", str(max_time),
           "-w", "%{http_code} %{remote_ip}"]
    cmd += ["--resolve", resolve] if resolve else ["--doh-url", DOH_URL]
    cmd.append(URL)
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=subproc_timeout)
    parts = (p.stdout.strip().splitlines()[-1] if p.stdout.strip() else "").split()
    code = parts[0] if parts else "000"
    ip = parts[1] if len(parts) > 1 else ""
    err = p.stderr.strip().splitlines()[-1] if p.stderr.strip() else ""
    return p.returncode, code, ip, err


def canary_ok() -> bool:
    """Plain egress check — distinguishes 'edge dead' from 'this box offline'."""
    p = subprocess.run(["curl", "-sS", "-o", "/dev/null", "--max-time", "8", CANARY_URL],
                       capture_output=True, timeout=30)
    return p.returncode == 0


def classify() -> tuple[str, str]:
    rc, code, ip, err = probe()
    detail = f"rc={rc} http={code} ip={ip or '-'}" + (f" err={err}" if err else "")
    if rc == 0 and code.isdigit() and 200 <= int(code) < 400:
        if ip in SELF_IPS:
            return "UNKNOWN", detail + " (resolved to tailnet self — probe did not traverse the public edge)"
        return "HEALTHY", detail
    if not canary_ok():
        return "UNKNOWN", detail + " (egress canary also failed — local internet, not the edge)"
    return "DEAD", detail


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except (OSError, ValueError):
        return {"status": "HEALTHY", "consecutive_fails": 0, "alerted": False,
                "heal_attempts": 0, "pending": None, "incident_since": None}


def save_state(st: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(st, indent=2) + "\n")
    tmp.replace(STATE_FILE)


def resolve_webhook() -> tuple[str, str]:
    """(url, varname) — prefer HUB_QA_WEBHOOK_URL, fall back to HUB_DOWNLOADS_WEBHOOK_URL.

    Per-var precedence: process env (ops/testing override) → .env.local. Today neither var
    is in the unit's env and HUB_QA is absent from .env.local, so this resolves to the
    HUB_DOWNLOADS value from .env.local — byte-identical to the prior read_webhook(). The URL
    is never returned to a printing caller. Raises if neither var is set anywhere."""
    file_vals: dict[str, str] = {}
    try:
        for line in (REPO / ".env.local").read_text().splitlines():
            for var in (QA_ENV_VAR, FALLBACK_ENV_VAR):
                if line.startswith(var + "="):
                    v = line.split("=", 1)[1].strip()
                    if v:
                        file_vals[var] = v
    except OSError:
        pass

    def pick(var: str) -> str | None:
        env_v = os.environ.get(var)
        if env_v and env_v.strip():
            return env_v.strip()
        return file_vals.get(var)

    qa = pick(QA_ENV_VAR)
    if qa:
        return qa, QA_ENV_VAR
    fb = pick(FALLBACK_ENV_VAR)
    if fb:
        return fb, FALLBACK_ENV_VAR
    raise RuntimeError(f"{QA_ENV_VAR} and {FALLBACK_ENV_VAR} both missing/empty (env + .env.local) — cannot alert")


def webhook_target_label() -> str:
    """Where the next alert would actually LAND, for the per-run log. Never the URL.

    🚨 This used to report the resolved VARNAME, which since B6-ALERTS is no longer the
    same fact as the destination: when the resolver falls back AND a bot token is present,
    the alert goes to #qa-agent over bot-token REST, not to #downloads. Reporting the
    varname would have printed '#downloads' for a message that lands in #qa-agent.
    """
    try:
        from alert_delivery import read_bot_token  # type: ignore

        _, name = resolve_webhook()
    except Exception:
        return "NONE"
    if name == QA_ENV_VAR:
        return f"{name} -> #qa-agent"
    if read_bot_token():
        return f"{name} resolved, but delivering to #qa-agent via bot-token (tier 2)"
    return f"{name} -> #downloads (fallback)"


def alert(build) -> bool:
    """Deliver through the ONE shared ladder (alert_delivery.post_alert). Never raises.

    `build(channel_label, note) -> str` — see _house(). The tier-1/2/3 ladder, the
    fail-open fall-through and the double-post guard all live in alert_delivery.
    """
    from alert_delivery import post_alert  # type: ignore

    if callable(build):
        render = lambda label, note: {"content": build(label, note)}  # noqa: E731
    else:  # a bare string still works — never break a caller mid-incident
        render = lambda label, note: {"content": str(build)}  # noqa: E731
    res = post_alert(render, source="funnel edge-watch alert",
                     dry_run=os.environ.get("FUNNEL_WATCH_DRY_RUN") == "1", log=_loud)
    return res.ok


def _run_ts(args: list[str], timeout: int) -> tuple[int, str]:
    """Run `sudo -n /usr/local/bin/tailscale <args>` with a hard timeout.
    Returns (rc, stderr_last_line). rc=-1 on timeout, -2 on any other exception.
    FUNNEL_WATCH_NO_HEAL=1 short-circuits to a benign success (never toggles the real Funnel)."""
    if os.environ.get("FUNNEL_WATCH_NO_HEAL") == "1":
        return 0, "NO_HEAL (skipped by FUNNEL_WATCH_NO_HEAL=1)"
    try:
        p = subprocess.run(["sudo", "-n", TAILSCALE, *args],
                           capture_output=True, text=True, timeout=timeout)
        err = p.stderr.strip().splitlines()[-1] if p.stderr.strip() else ""
        return p.returncode, err
    except subprocess.TimeoutExpired:
        return -1, f"timeout after {timeout}s"
    except Exception as e:  # pragma: no cover — defensive; a heal must never crash the run
        return -2, _scrub(e)


def heal(deadline: float) -> tuple[str, str]:
    """Revive the Funnel edge: `funnel --https=443 off && funnel --bg --https=443 3000`.

    NEVER leaves the Funnel off: retries --bg once; a persistent --bg failure AFTER a
    successful off => 'left_off' (loudest). `deadline` (time.monotonic) bounds the re-probe
    tail; the tailscale calls are each hard-timeout'd. Returns (outcome, detail):
      healed              — re-armed AND re-probe HEALTHY
      rearmed_still_dead  — re-armed but re-probe still DEAD
      rearmed_unconfirmed — re-armed, no budget left to re-probe (Funnel IS on)
      left_off            — off ok, --bg failed twice: Hub may be fully DOWN
      rearm_failed        — off failed AND --bg failed: Funnel NOT left off (prior state)
    """
    rc_off, err_off = _run_ts(["funnel", "--https=443", "off"], HEAL_STEP_TIMEOUT_S)
    off_ok = rc_off == 0

    rc_bg, err_bg = _run_ts(["funnel", "--bg", "--https=443", "3000"], HEAL_STEP_TIMEOUT_S)
    if rc_bg != 0:
        rc_bg, err_bg = _run_ts(["funnel", "--bg", "--https=443", "3000"], HEAL_STEP_TIMEOUT_S)  # one retry

    if rc_bg != 0:
        if off_ok:
            return "left_off", f"off rc=0; --bg failed twice (last err={err_bg or '-'})"
        return "rearm_failed", f"off rc={rc_off} (err={err_off or '-'}); --bg failed (err={err_bg or '-'})"

    # Funnel re-armed (ON). Re-probe within the remaining budget — a slow re-probe can no
    # longer leave the Funnel off, so it is outside the danger window.
    remaining = deadline - time.monotonic()
    if remaining < REPROBE_MIN_S:
        return "rearmed_unconfirmed", f"re-armed; skipped re-probe (budget {remaining:.0f}s < {REPROBE_MIN_S}s)"
    mt = int(min(REPROBE_MAX_TIME_S, max(2, remaining - 2)))
    try:
        rc, code, ip, err = probe(max_time=mt, subproc_timeout=mt + 4)
    except Exception as e:
        return "rearmed_unconfirmed", f"re-armed; re-probe errored ({e})"
    healthy = rc == 0 and code.isdigit() and 200 <= int(code) < 400 and ip not in SELF_IPS
    detail = f"re-armed; re-probe rc={rc} http={code} ip={ip or '-'}" + (f" err={err}" if err else "")
    return ("healed", detail) if healthy else ("rearmed_still_dead", detail)


def _post_down(st: dict, build) -> None:
    """Fire a state-change DOWN alert ONCE per incident (retry-until-delivered on POST failure)."""
    from alert_delivery import scrub  # type: ignore

    if st.get("alerted"):
        return
    try:
        st["alerted"] = bool(alert(build))
        st["last_alert"] = utcnow()
    except Exception as e:
        _loud(f"down alert failed: {scrub(e)}")
        st["alerted"] = False


def _post_flap(st: dict, what: str) -> bool:
    """Post the ONE-LINE 🔵 INFO for a self-cleared incident. Returns delivered?.

    Never raises: an INFO line failing to send must not crash a probe run.
    """
    from alert_delivery import scrub  # type: ignore

    try:
        delivered = bool(alert(flapped(st.get("incident_since"), what)))
    except Exception as e:  # noqa: BLE001
        _loud(f"flap INFO alert failed: {scrub(e)}")
        delivered = False
    if delivered:
        st["last_alert"] = utcnow()
    st["alerted"] = False
    return delivered


def main() -> int:
    start = time.monotonic()
    verdict, detail = classify()
    st = load_state()
    prev = st.get("status", "HEALTHY")
    st.setdefault("heal_attempts", 0)  # additive: state files predating auto-heal lack the key
    st["last_check"] = utcnow()
    st["last_detail"] = detail

    if verdict == "HEALTHY":
        st["last_ok"] = utcnow()
        st["consecutive_fails"] = 0
        pending = st.get("pending")
        if pending:
            # THE TRANSIENT CASE — the held incident cleared on its own. ONE 🔵 INFO line,
            # after the fact. The hold is released only on CONFIRMED delivery (or once the
            # bound expires), so a webhook blip retries next tick instead of losing the
            # notice — the same discipline _post_down uses for a page.
            delivered = _post_flap(st, "recovered on its own")
            if delivered or _age_s(pending.get("since")) > PENDING_MAX_HOLD_S:
                st["pending"] = None
                st["incident_since"] = None
        elif prev == "DEAD" and st.get("alerted"):
            try:
                alert(recovered(detail))
            except Exception as e:  # alert is best-effort; recovery is visible anyway
                _loud(f"recovery alert failed: {_scrub(e)}")
            st["alerted"] = False
            st["incident_since"] = None
        else:
            st["incident_since"] = None
        st["heal_attempts"] = 0  # incident over — reset the per-incident cap
        st["status"] = "HEALTHY"

    elif verdict == "DEAD":
        # classify() already returned DEAD only because the egress canary PASSED — a local
        # outage classifies UNKNOWN and never reaches here, so the canary gate is preserved
        # upstream and needs no re-check inside the heal.
        if not st.get("incident_since"):
            st["incident_since"] = utcnow()  # the window the INFO line will name
        st["consecutive_fails"] = int(st.get("consecutive_fails", 0)) + 1
        if st["consecutive_fails"] >= FAILS_TO_ALERT:
            st["status"] = "DEAD"
            heal_attempts = int(st.get("heal_attempts", 0))
            elapsed = time.monotonic() - start
            can_start = elapsed < HEAL_START_DEADLINE_S  # guarantees time to finish --bg + alert in budget
            if heal_attempts < HEAL_CAP and can_start:
                st["heal_attempts"] = heal_attempts + 1
                st["last_heal_at"] = utcnow()
                outcome, hdetail = heal(start + ONESHOT_BUDGET_S - POST_RESERVE_S)
                st["last_heal_outcome"] = outcome
                if outcome == "healed":
                    # Self-recovering and CONFIRMED — the same class as a held flap, so it
                    # gets the same single 🔵 INFO line rather than a ✅ RECOVERED card.
                    st["status"] = "HEALTHY"
                    st["consecutive_fails"] = 0
                    st["heal_attempts"] = 0
                    st["last_ok"] = utcnow()
                    _post_flap(st, f"auto-heal revived it on attempt {heal_attempts + 1}")
                    st["pending"] = None
                    st["incident_since"] = None
                elif outcome == "left_off":
                    # LOUDEST — fire on every occurrence (bounded by HEAL_CAP), before anything else.
                    # 🚨 NEVER HELD: the Funnel may be OFF right now.
                    try:
                        posted = alert(left_off(st["consecutive_fails"], hdetail))
                        st["alerted"] = bool(posted) or bool(st.get("alerted"))
                        st["last_alert"] = utcnow()
                    except Exception as e:
                        _loud(f"left-off alert failed: {_scrub(e)}")
                    st["pending"] = None
                elif outcome in _HOLD_OUTCOMES and not st.get("pending") and not st.get("alerted"):
                    # 🚨 THE ONE-TICK HOLD. Both tailscale calls returned rc=0, so the edge IS
                    # armed; only the re-probe is unconfirmed, and it fires within
                    # REPROBE_MAX_TIME_S of a re-arm that needs ~2.5 min to settle. Paging now
                    # would assert a verdict this tick cannot hold. Wait exactly one cycle.
                    st["pending"] = {"since": utcnow(), "detail": detail,
                                     "heal_detail": hdetail, "fails": st["consecutive_fails"]}
                    _loud(f"edge DEAD, auto-heal re-armed it ({outcome}) — HOLDING the BROKEN "
                          f"alert for ONE probe cycle; the re-probe fires within "
                          f"{REPROBE_MAX_TIME_S}s of the re-arm and cannot confirm it yet. "
                          f"Next tick: HEALTHY -> one INFO line, still DEAD -> full page.")
                else:  # a second still-dead cycle, or rearm_failed — CONFIRMED, page now
                    held = st.pop("pending", None)
                    _post_down(st, down_heal_failed(st["consecutive_fails"], detail, hdetail,
                                                    held_since=(held or {}).get("since")))
            else:
                reason = "heal cap reached" if heal_attempts >= HEAL_CAP else (
                    f"insufficient time budget ({elapsed:.0f}s into tick)")
                st["pending"] = None
                _post_down(st, down_heal_skipped(st["consecutive_fails"], detail, reason))
        # below threshold: grace window — status unchanged, no alert, no heal
    else:  # UNKNOWN — this box's connectivity or a self-resolve; never an edge verdict, never healed
        st["status"] = prev
        pending = st.get("pending")
        # 🚨 HOLD, DON'T CLEAR, DON'T POST. UNKNOWN means THIS box's egress is down, so the
        # edge verdict is unknowable: clearing would be a false green and paging would blame
        # the edge for a local outage. But a hold must never become a stranded incident —
        # past the bound, report the last known DEAD state and say exactly why it is unconfirmed.
        if pending and _age_s(pending.get("since")) > PENDING_MAX_HOLD_S:
            st["pending"] = None
            held = _et_hm(pending.get("since")) or "an unrecorded time"
            _post_down(st, down_heal_skipped(
                pending.get("fails", st.get("consecutive_fails", 0)),
                pending.get("detail", detail),
                f"held since {held} awaiting re-confirmation, but this box's egress has been "
                f"down since — the edge verdict cannot be re-checked, so the last known DEAD "
                f"state is reported rather than held any longer"))

    save_state(st)
    # `pending=` is on the status line deliberately: a held alert that leaves no trace in
    # the journal is indistinguishable from a swallowed one.
    print(f"{utcnow()} funnel-edge-watch verdict={verdict} status={st['status']} "
          f"fails={st.get('consecutive_fails', 0)} heal_attempts={st.get('heal_attempts', 0)} "
          f"pending={'held since ' + str((st.get('pending') or {}).get('since')) if st.get('pending') else 'no'} "
          f"webhook_target={webhook_target_label()} {detail}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
