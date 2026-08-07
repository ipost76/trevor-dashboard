#!/usr/bin/env python3
"""B6-ALERTS — the ONE WSL alert-delivery path, plus the house alert shape.

🚨 THIS FILE ADOPTS A PROVEN TRANSPORT. IT DOES NOT INVENT ONE. The three-tier
ladder and the bot-token POST below are MOVED, in behaviour, from
``scripts/watcher_alert.py`` (B4-HUB-RESILIENCE, 2026-08-02), which is the only
WSL poster that already reached #qa-agent. Tier 2 is not theoretical: it is
DIRECTLY OBSERVED delivering from this box —

    Aug 02 19:40:58  POSTED trevor-dashboard.service's death alert to #qa-agent
                     (bot-token REST — the #qa-agent webhook mint is perm-blocked) (HTTP 200)
    Aug 06 09:58:32  POSTED trevor-tailsync.service's death alert to #qa-agent
                     (bot-token REST — the #qa-agent webhook mint is perm-blocked) (HTTP 200)

and a read-only ``GET /api/v10/channels/<qa>`` from WSL returns 200 ``name=qa-agent``.
Three alternatives were ruled out on evidence and MUST NOT be re-attempted here:
minting HUB_QA_WEBHOOK_URL (403 on *Manage Webhooks*, open since 2026-07-14 — Send
Messages is a DIFFERENT permission, which is why posting works and minting does not),
routing WSL alerts through the VM (WSL-local transport is what lets a death alert
survive an unreachable VM), and hand-minting a webhook (a second secret for no gain).

THE LADDER, in priority order — identical to watcher_alert's:
  1. HUB_QA_WEBHOOK_URL webhook -> #qa-agent   (preferred: no token; absent today)
  2. bot-token REST             -> #qa-agent   (the live path today)
  3. HUB_DOWNLOADS_WEBHOOK_URL  -> #downloads  (LAST RESORT, never silently preferred)

🚨 FAIL-OPEN IS THE POINT. Tier 2 is tried ONLY when the resolver fell back, i.e.
exactly the case that used to misroute an ops alert into the artefact channel, and a
tier-2 failure FALLS THROUGH to tier 3 rather than losing the alert. Adding a tier can
only re-route a message, never drop one. These posters exist to report other things
dying; losing an alert is worse than duplicating one.

🚨 THE DOUBLE-POST GUARD IS THREE-VALUED, BECAUSE THE TRUTH IS. A tier-2 attempt ends
in one of three states, and collapsing them to a boolean is what creates either a lost
alert or a silent duplicate:
  DELIVERED    2xx received       -> STOP. Tier 3 is not fired. (the guard)
  NOT_DELIVERED a non-2xx response was received, OR the request provably never left
               the box (connect-stage failure: DNS, refused, connect timeout)
                                  -> fall through to tier 3. A duplicate is impossible.
  UNCONFIRMED  the request WAS transmitted and no response came back (read timeout,
               reset mid-response)
                                  -> fall through to tier 3 ANYWAY (never lose an
                                     alert) and hand the caller a NOTE so the second
                                     copy is LABELLED as a possible duplicate. A
                                     duplicate that says so is fine; a silent one is not.

🚨 NEVER PRINT A RAW ``requests`` EXCEPTION. ``requests``/``urllib3`` embed the FULL
request URL in ``HTTPSConnectionPool(...)`` errors, and for a Discord webhook that URL
IS the credential (``/api/webhooks/<id>/<token>``). This box's journal already carries
the complete HUB_DOWNLOADS_WEBHOOK_URL three times (2026-07-28, 2026-07-29 x2) from
exactly that path. Every error string that leaves this module goes through ``scrub()``,
and every caller uses ``describe_failure()`` instead of ``str(exc)``.

THE HOUSE SHAPE (``house_alert``):
    <icon> <SEVERITY> — <one line: what is wrong> (Ghost)
    <1-4 short fact lines, plain English, no raw dicts>
    → <what it means / what is affected>
    <source> · <ET timestamp>
<= 8 lines, <= 900 chars, ENFORCED IN CODE, with truncation always VISIBLE — a cut
alert must never look complete. Severity is one of exactly four.

This module posts nothing on import and holds no state.
"""
from __future__ import annotations

import os
import re
import socket
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
REPO = _HERE.parent

# B4-HUB-RESILIENCE: the tier-2 channel. Matches the VM monitor's HUB_MONITOR_QA_CHANNEL_ID
# (#qa-agent) — the same channel, reached the same way. Confirmed read-only 2026-08-06:
# GET /api/v10/channels/1479969192139690029 -> 200, name=qa-agent.
QA_CHANNEL_ID = os.environ.get("ALERT_QA_CHANNEL_ID", "1479969192139690029")
BOT_TOKEN_VAR = "DISCORD_BOT_TOKEN"
USER_AGENT = "trevor-alert-delivery/1 (B6-ALERTS)"
HTTP_TIMEOUT = 15

# Delivery outcomes for ONE tier attempt. See the docstring — three, not two.
DELIVERED, NOT_DELIVERED, UNCONFIRMED = "delivered", "not_delivered", "unconfirmed"

# ── the house alert shape ────────────────────────────────────────────────────
SEV_BROKEN = ("\U0001F6A8", "BROKEN")
SEV_DEGRADED = ("⚠️", "DEGRADED")
SEV_INFO = ("\U0001F535", "INFO")
SEV_RECOVERED = ("✅", "RECOVERED")

MAX_LINES = 8
MAX_CHARS = 900
MAX_FACT_LINES = 4
_MIN_LINE = 24  # a line clipped below this carries no information; stop clipping it

# The box name is MEASURED, never hardcoded — a baked "Ghost" becomes a lie the day
# this runs anywhere else, and the whole point of the line is to say which box spoke.
try:
    BOX = socket.gethostname() or "Ghost"
except Exception:  # noqa: BLE001 - a name lookup must never break an alert
    BOX = "Ghost"


def et_stamp(now: datetime | None = None) -> str:
    """'2026-08-06 11:42 PM EDT' — DST-aware via %Z on an AWARE datetime.

    Never a hardcoded ' ET' literal (it drifts from real DST and diverges from the VM's
    EDT/EST). A tzdata failure degrades to a present, explicit UTC stamp — an alert must
    never die for want of a timestamp, and an EMPTY stamp would read as 'unknown when'.
    """
    try:
        from zoneinfo import ZoneInfo

        dt = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo("America/New_York"))
        hour = dt.strftime("%I").lstrip("0") or "12"
        return f"{dt:%Y-%m-%d} {hour}:{dt:%M} {dt:%p} {dt:%Z}"
    except Exception:  # noqa: BLE001 - see above
        dt = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        return f"{dt:%Y-%m-%d %H:%M} UTC (ET unavailable)"


def _clip(text: str, limit: int) -> str:
    """Shorten VISIBLY. A cut line must never be mistakable for a complete one."""
    marker = "…[clipped]"
    if limit <= len(marker):
        return marker
    if len(text) <= limit:
        return text
    return text[: limit - len(marker)].rstrip() + marker


def _fit(lines: list[str]) -> str:
    """Enforce MAX_LINES / MAX_CHARS in CODE, not by convention, and show every cut.

    The FRAME (line 0 = the headline, line -1 = source + stamp) is protected: it is what
    makes the alert actionable and identifiable. Facts are clipped longest-first instead.
    """
    lines = [str(ln) for ln in lines if ln is not None]
    if not lines:
        return ""
    if len(lines) > MAX_LINES:
        dropped = len(lines) - MAX_LINES + 1
        lines = lines[: MAX_LINES - 2] + [f"[+{dropped} line(s) truncated]", lines[-1]]

    def total(ls: list[str]) -> int:
        return len("\n".join(ls))

    guard = 0
    while total(lines) > MAX_CHARS and guard < 500:
        guard += 1
        middle = [i for i in range(1, len(lines) - 1) if len(lines[i]) > _MIN_LINE]
        if not middle:
            break
        i = max(middle, key=lambda k: len(lines[k]))
        lines[i] = _clip(lines[i], max(_MIN_LINE, len(lines[i]) // 2))
    if total(lines) > MAX_CHARS:
        over = total(lines) - MAX_CHARS
        lines[0] = _clip(lines[0], max(_MIN_LINE, len(lines[0]) - over))
    text = "\n".join(lines)
    if len(text) > MAX_CHARS:
        text = text[: MAX_CHARS - 13].rstrip() + "…[TRUNCATED]"
    return text


def house_alert(severity, headline: str, facts, meaning: str, source: str,
                stamp: str | None = None) -> str:
    """Render the house shape. `severity` is one of the four SEV_* tuples."""
    icon, word = severity
    kept = [str(f).strip() for f in (facts or []) if f and str(f).strip()]
    if len(kept) > MAX_FACT_LINES:
        hidden = len(kept) - MAX_FACT_LINES
        kept = kept[:MAX_FACT_LINES]
        kept[-1] = f"{kept[-1]}  [+{hidden} more not shown]"
    lines = [f"{icon} {word} — {headline} ({BOX})"]
    lines += kept
    if meaning:
        lines.append(f"→ {meaning}")
    lines.append(f"{source} · {stamp or et_stamp()}")
    return _fit(lines)


# ── secret scrubbing ─────────────────────────────────────────────────────────
_URL_RE = re.compile(r"https?://[^\s'\"<>)\]},]+", re.I)

# 🚨 THE BARE-PATH FORM IS THE ONE THAT ACTUALLY LEAKED, AND A URL REGEX MISSES IT.
# urllib3 does NOT print the full URL in its pool errors — it prints the HOST separately
# and the PATH on its own:
#     HTTPSConnectionPool(host='discord.com', port=443): Max retries exceeded with
#     url: /api/webhooks/<id>/<token> (Caused by SSLError(...))
# The path alone is the whole credential. Measured against the real journal on this box:
# with only the https:// pattern, all three leaked lines survived scrubbing intact.
_WEBHOOK_PATH_RE = re.compile(r"/api/(?:v\d+/)?webhooks/\d+/[A-Za-z0-9_.\-]+", re.I)


def _redact(match: re.Match) -> str:
    url = match.group(0)
    try:
        parts = urlsplit(url)
        host = parts.netloc or "?"
        scheme = parts.scheme or "https"
    except Exception:  # noqa: BLE001
        return "<redacted-url>"
    return f"{scheme}://{host}/<redacted>"


def scrub(text: object) -> str:
    """Strip credentials from any string bound for a log or an alert body.

    Removes, in this order:
      1. every full URL past its host (a Discord webhook URL IS the credential),
      2. every BARE `/api/webhooks/<id>/<token>` path — the form urllib3 actually emits,
         and the one that leaked here three times,
      3. the bot token, if it ever appears verbatim.
    The HOST is kept deliberately: 'discord.com' is not a secret and it is the diagnostic
    half of the message.
    """
    s = "" if text is None else str(text)
    s = _URL_RE.sub(_redact, s)
    s = _WEBHOOK_PATH_RE.sub("/api/webhooks/<redacted>", s)
    token = os.environ.get(BOT_TOKEN_VAR, "").strip()
    if token and len(token) > 8:
        s = s.replace(token, "<redacted-token>")
    return s


def describe_failure(exc: BaseException) -> tuple[str, bool | None]:
    """(scrubbed one-line detail, transmitted?) — NEVER a stack trace, NEVER a raw URL.

    `transmitted` is False when the request PROVABLY never left the box (so a retry on
    another tier cannot duplicate anything), and None when it may have been sent and the
    outcome is unknowable from here. It is never True: a transmitted-and-answered request
    is not a failure.
    """
    name = type(exc).__name__
    detail = f"{name}: {scrub(exc)[:180]}" if str(exc) else name
    try:
        import requests  # type: ignore

        if isinstance(exc, requests.exceptions.ConnectTimeout):
            return detail, False  # the TCP/TLS handshake never completed
        if isinstance(exc, requests.exceptions.ReadTimeout):
            return detail, None  # sent; the reply never arrived
        if isinstance(exc, requests.exceptions.ConnectionError):
            # DNS failure / connection refused / no route = nothing was transmitted.
            # A reset mid-stream is a different animal and stays unknown.
            blob = f"{type(exc).__name__} {exc!r}"
            if any(k in blob for k in ("NameResolutionError", "NewConnectionError",
                                       "Failed to resolve", "Connection refused",
                                       "Name or service not known")):
                return detail, False
            return detail, None
    except Exception:  # noqa: BLE001 - requests missing/broken; stay conservative
        pass
    return detail, None


# ── the transport ────────────────────────────────────────────────────────────
def read_bot_token() -> str:
    """DISCORD_BOT_TOKEN from the process env, else .env.local. '' when unavailable.

    🚨 NEVER logged, never returned to a printing caller, never put in an alert body.
    The units carry EnvironmentFile=.env.local, so under systemd this normally hits the
    env branch; the file read is the fallback for a hand-run invocation.
    """
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


def _loud(msg: str, log=None) -> None:
    if log is not None:
        log(msg)
    else:
        print(f"[alert_delivery] {msg}", file=sys.stderr, flush=True)


def post_bot_channel(channel_id: str, payload: dict) -> tuple[str, object, str]:
    """Tier 2 — POST one message to a channel with the bot token.

    Returns (outcome, http_code, detail) where outcome is DELIVERED / NOT_DELIVERED /
    UNCONFIRMED. Never raises, never logs the token, never logs a raw URL.
    """
    token = read_bot_token()
    if not token:
        return NOT_DELIVERED, None, f"{BOT_TOKEN_VAR} unavailable"
    try:
        import requests  # type: ignore

        resp = requests.post(
            f"https://discord.com/api/v10/channels/{channel_id}/messages",
            json=payload,
            headers={"Authorization": f"Bot {token}", "User-Agent": USER_AGENT},
            timeout=HTTP_TIMEOUT,
        )
    except Exception as exc:  # noqa: BLE001 - a WSL->internet outage lands here; be LOUD
        detail, transmitted = describe_failure(exc)
        return (NOT_DELIVERED if transmitted is False else UNCONFIRMED), None, detail
    if resp.status_code in (200, 201, 204):
        return DELIVERED, resp.status_code, ""
    # A response came back and it was a refusal: nothing was posted. Safe to fall through.
    return NOT_DELIVERED, resp.status_code, scrub(resp.text or "")[:200]


def post_webhook(url: str, payload: dict) -> tuple[str, object, str]:
    """Tier 1 / tier 3 — POST to a Discord webhook. Same three-valued contract."""
    try:
        import requests  # type: ignore

        resp = requests.post(
            url,
            json=payload,
            headers={"User-Agent": USER_AGENT},  # EXPLICIT UA (the C1 mandate)
            timeout=HTTP_TIMEOUT,
        )
    except Exception as exc:  # noqa: BLE001
        detail, transmitted = describe_failure(exc)
        return (NOT_DELIVERED if transmitted is False else UNCONFIRMED), None, detail
    if resp.status_code in (200, 204):
        return DELIVERED, resp.status_code, ""
    return NOT_DELIVERED, resp.status_code, scrub(resp.text or "")[:300]


class Delivery:
    """The outcome of one full ladder run. `ok` means a tier confirmed 2xx."""

    __slots__ = ("ok", "tier", "label", "long_label", "detail", "note", "unconfirmed")

    def __init__(self, ok, tier, label, long_label, detail="", note=None, unconfirmed=False):
        self.ok = ok
        self.tier = tier
        self.label = label
        self.long_label = long_label
        self.detail = detail
        self.note = note
        self.unconfirmed = unconfirmed

    def __repr__(self) -> str:  # pragma: no cover - diagnostics only
        return (f"Delivery(ok={self.ok}, tier={self.tier}, label={self.label!r}, "
                f"detail={self.detail!r}, unconfirmed={self.unconfirmed})")


_QA_WEBHOOK_LABEL = "#qa-agent (HUB_QA_WEBHOOK_URL)"
_QA_BOT_LABEL = "#qa-agent (bot-token REST — the #qa-agent webhook mint is perm-blocked)"
_DOWNLOADS_LABEL = ("#downloads (HUB_DOWNLOADS_WEBHOOK_URL — LAST RESORT; both the "
                    "#qa-agent webhook and the bot-token path were unavailable)")
_SHORT = {
    _QA_WEBHOOK_LABEL: "#qa-agent (webhook)",
    _QA_BOT_LABEL: "#qa-agent (bot-token)",
    _DOWNLOADS_LABEL: "#downloads (last resort)",
}
_DUP_NOTE = ("⚠️ possible duplicate — the #qa-agent attempt was transmitted but "
             "UNCONFIRMED, so this copy was sent rather than risk losing the alert")


def post_alert(render, *, source: str, dry_run: bool = False, log=None) -> Delivery:
    """Run the three-tier ladder. NEVER raises.

    `render(short_label, note) -> dict` builds the Discord payload — a `{"content": ...}`
    or `{"embeds": [...]}` body. It is a CALLABLE, not a string, so the message can state
    the channel AND mechanism it actually travelled by (the RF2-C1 contract) and so the
    tier-3 copy can be re-rendered carrying the possible-duplicate note.
    """
    try:
        from funnel_edge_watch import QA_ENV_VAR, resolve_webhook  # type: ignore

        url, varname = resolve_webhook()
    except Exception as exc:  # noqa: BLE001 - resolve failure MUST be loud, never silent
        detail = scrub(exc)[:200]
        _loud(f"FAILED to resolve a webhook for {source}: {detail}. Alert NOT sent — "
              f"a human must see this line.", log)
        return Delivery(False, None, "none", "none", detail)

    use_bot = varname != QA_ENV_VAR and bool(read_bot_token())
    long_label = _QA_BOT_LABEL if use_bot else (
        _QA_WEBHOOK_LABEL if varname == QA_ENV_VAR else _DOWNLOADS_LABEL)
    short = _SHORT[long_label]

    if dry_run:
        payload = render(short, None)
        _loud(f"DRY_RUN: would POST {source} to {long_label} ({varname}); not posting.", log)
        print(payload.get("content") or payload)
        return Delivery(True, "dry-run", short, long_label)

    note = None
    if use_bot:
        outcome, code, detail = post_bot_channel(QA_CHANNEL_ID, render(short, None))
        if outcome == DELIVERED:
            _loud(f"POSTED {source} to {long_label} (HTTP {code}).", log)
            return Delivery(True, 2, short, long_label)
        if outcome == UNCONFIRMED:
            # Transmitted, no answer. Fall through so the alert is not LOST, but say so:
            # a labelled duplicate is recoverable, a silent one teaches nobody.
            note = _DUP_NOTE
            _loud(f"tier-2 bot-token post to #qa-agent UNCONFIRMED ({detail}) — the "
                  f"request was transmitted and may have landed. Falling back to the "
                  f"{varname} webhook anyway so the alert is not lost; the copy is "
                  f"labelled as a possible duplicate.", log)
        else:
            _loud(f"tier-2 bot-token post to #qa-agent FAILED (HTTP {code} {detail!r}) — "
                  f"falling back to the {varname} webhook so the alert is not lost.", log)
        long_label = _QA_WEBHOOK_LABEL if varname == QA_ENV_VAR else _DOWNLOADS_LABEL
        short = _SHORT[long_label]

    outcome, code, detail = post_webhook(url, render(short, note))
    tier = 1 if varname == QA_ENV_VAR else 3
    if outcome == DELIVERED:
        _loud(f"POSTED {source} to {long_label} (HTTP {code}).", log)
        return Delivery(True, tier, short, long_label, note=note)
    _loud(f"FAILED to deliver {source} to {long_label}: HTTP {code} {detail!r}. "
          f"Alert NOT delivered.", log)
    return Delivery(False, tier, short, long_label, detail, note,
                    unconfirmed=(outcome == UNCONFIRMED))
