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
✅ on recovery or auto-heal. Silent while healthy. A failed probe with a failed
egress canary classifies as UNKNOWN (this box's internet, not the edge) —
logged, never alerted, state untouched, never healed.

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

import requests  # same client as scripts/discord_file_delivery.py — Discord's
                 # Cloudflare 403s urllib's default UA; requests passes.

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

DOWN_HEAL_FAILED_MSG = (
    "🚨 **Hub Funnel edge DOWN — auto-heal FAILED** — public https://trevorhub-wsl.tail2bf7a3.ts.net "
    "is failing via the Tailscale public edge ({fails} consecutive checks; {detail}). "
    "Auto-heal ran and did NOT stick ({hdetail}). The box + tailnet path are likely still fine — this "
    "is the edge leg (same failure mode as the Jun 30 silent death, recon A3). Manual revive from the "
    "WSL box: " + REVIVE_CMD + ". (trevor-funnel-watch, FUNNEL-B1)"
)
DOWN_HEAL_SKIPPED_MSG = (
    "🚨 **Hub Funnel edge DOWN — auto-heal SKIPPED** — public https://trevorhub-wsl.tail2bf7a3.ts.net "
    "is failing via the Tailscale public edge ({fails} consecutive checks; {detail}). "
    "Auto-heal was skipped this tick ({reason}). The box + tailnet path are likely still fine — this is "
    "the edge leg. Manual revive from the WSL box: " + REVIVE_CMD + ". (trevor-funnel-watch, FUNNEL-B1)"
)
HEALED_MSG = (
    "✅ **Hub Funnel edge AUTO-HEALED** — public https://trevorhub-wsl.tail2bf7a3.ts.net went dark and "
    "was automatically revived (attempt {attempts}; {detail}). No action needed. (trevor-funnel-watch, FUNNEL-B1)"
)
LEFT_OFF_MSG = (
    "🚨🚨 **Hub Funnel may be LEFT OFF — public Hub DOWN** — auto-heal turned the Funnel off but FAILED "
    "to turn it back on ({fails} consecutive dead checks; {detail}). trevorhub-wsl.tail2bf7a3.ts.net may "
    "be fully unreachable RIGHT NOW. Re-arm manually from the WSL box IMMEDIATELY: " + REVIVE_CMD
    + ". (trevor-funnel-watch, FUNNEL-B1)"
)
RECOVERED_MSG = (
    "✅ Hub Funnel edge RECOVERED — public https://trevorhub-wsl.tail2bf7a3.ts.net "
    "is serving again ({detail}). (trevor-funnel-watch)"
)


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
        return {"status": "HEALTHY", "consecutive_fails": 0, "alerted": False, "heal_attempts": 0}


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
    """The VARNAME (not the URL) the next alert would use, for the per-run log. 'NONE' if unresolved."""
    try:
        _, name = resolve_webhook()
    except Exception:
        return "NONE"
    return name if name == QA_ENV_VAR else f"{name} (fallback)"


def alert(msg: str) -> bool:
    url, name = resolve_webhook()
    label = name if name == QA_ENV_VAR else f"{name} (fallback)"
    if os.environ.get("FUNNEL_WATCH_DRY_RUN") == "1":
        print(f"[DRY_RUN] webhook_target={label} would post: {msg}")
        return True
    resp = requests.post(url, json={"content": msg}, timeout=15)
    print(f"alert posted webhook_target={label} status={resp.status_code}", file=sys.stderr)
    return resp.status_code in (200, 204)


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
        return -2, str(e)


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


def _post_down(st: dict, msg: str) -> None:
    """Fire a state-change DOWN alert ONCE per incident (retry-until-delivered on POST failure)."""
    if st.get("alerted"):
        return
    try:
        st["alerted"] = bool(alert(msg))
        st["last_alert"] = utcnow()
    except Exception as e:
        print(f"down alert failed: {e}", file=sys.stderr)
        st["alerted"] = False


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
        if prev == "DEAD" and st.get("alerted"):
            try:
                alert(RECOVERED_MSG.format(detail=detail))
            except Exception as e:  # alert is best-effort; recovery is visible anyway
                print(f"recovery alert failed: {e}", file=sys.stderr)
            st["alerted"] = False
        st["heal_attempts"] = 0  # incident over — reset the per-incident cap
        st["status"] = "HEALTHY"

    elif verdict == "DEAD":
        # classify() already returned DEAD only because the egress canary PASSED — a local
        # outage classifies UNKNOWN and never reaches here, so the canary gate is preserved
        # upstream and needs no re-check inside the heal.
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
                    st["status"] = "HEALTHY"
                    st["consecutive_fails"] = 0
                    st["heal_attempts"] = 0
                    st["last_ok"] = utcnow()
                    try:
                        alert(HEALED_MSG.format(attempts=heal_attempts + 1, detail=hdetail))
                    except Exception as e:
                        print(f"heal-success alert failed: {e}", file=sys.stderr)
                    st["alerted"] = False  # ✅ auto-healed supersedes any DOWN this incident
                elif outcome == "left_off":
                    # LOUDEST — fire on every occurrence (bounded by HEAL_CAP), before anything else.
                    try:
                        posted = alert(LEFT_OFF_MSG.format(fails=st["consecutive_fails"], detail=hdetail))
                        st["alerted"] = bool(posted) or bool(st.get("alerted"))
                        st["last_alert"] = utcnow()
                    except Exception as e:
                        print(f"left-off alert failed: {e}", file=sys.stderr)
                else:  # rearmed_still_dead / rearmed_unconfirmed / rearm_failed
                    _post_down(st, DOWN_HEAL_FAILED_MSG.format(
                        fails=st["consecutive_fails"], detail=detail, hdetail=hdetail))
            else:
                reason = "heal cap reached" if heal_attempts >= HEAL_CAP else (
                    f"insufficient time budget ({elapsed:.0f}s into tick)")
                _post_down(st, DOWN_HEAL_SKIPPED_MSG.format(
                    fails=st["consecutive_fails"], detail=detail, reason=reason))
        # below threshold: grace window — status unchanged, no alert, no heal
    else:  # UNKNOWN — this box's connectivity or a self-resolve; never an edge verdict, never healed
        st["status"] = prev

    save_state(st)
    print(f"{utcnow()} funnel-edge-watch verdict={verdict} status={st['status']} "
          f"fails={st.get('consecutive_fails', 0)} heal_attempts={st.get('heal_attempts', 0)} "
          f"webhook_target={webhook_target_label()} {detail}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
