#!/usr/bin/env python3
"""TREVOR Hub — Funnel edge-health watch  [FUNNEL-B1 / edge-health-watch]

Probes the PUBLIC Tailscale Funnel edge the way an outside client reaches it:
the Hub hostname is resolved via Google DoH (never the box resolver — MagicDNS
would short-circuit to the tailnet IP and self-test the box, which stayed green
through the Jun 30 edge death). HEALTHY requires an HTTP 2xx/3xx AND the
connection landing on a public edge IP, not this node's own tailnet address.

Alerts Ghost's #downloads webhook (HUB_DOWNLOADS_WEBHOOK_URL in .env.local,
never hardcoded/printed) on STATE CHANGE only: one 🚨 when the edge goes dead
(>= FAILS_TO_ALERT consecutive fails), one ✅ on recovery. Silent while
healthy. A failed probe with a failed egress canary classifies as UNKNOWN
(this box's internet, not the edge) — logged, never alerted, state untouched.

State: data/funnel-edge-status.json (data/ is gitignored). Driven by
trevor-funnel-watch.timer every 15 min. Always exits 0 unless it crashes —
a dead edge is signalled by the alert, not a failed unit.

Test hooks (install verification only — not used by the timer):
  FUNNEL_WATCH_RESOLVE=host:443:ip   pin the probe target instead of DoH
  FUNNEL_WATCH_STATE=/path           alternate state file
  FUNNEL_WATCH_DRY_RUN=1             log the would-be alert, don't POST
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
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
ENV_VAR = "HUB_DOWNLOADS_WEBHOOK_URL"

DOWN_MSG = (
    "🚨 **Hub Funnel edge DOWN** — public https://trevorhub-wsl.tail2bf7a3.ts.net "
    "is failing via the Tailscale public edge ({fails} consecutive checks; {detail}). "
    "The box + tailnet path are likely still fine — this is the edge leg (same failure "
    "mode as the Jun 30 silent death, recon A3). Revive from the WSL box: "
    "`sudo tailscale funnel --https=443 off && sudo tailscale funnel --bg --https=443 3000`, "
    "then re-run `python3 scripts/funnel_edge_watch.py`. (trevor-funnel-watch, FUNNEL-B1)"
)
RECOVERED_MSG = (
    "✅ Hub Funnel edge RECOVERED — public https://trevorhub-wsl.tail2bf7a3.ts.net "
    "is serving again ({detail}). (trevor-funnel-watch)"
)


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def probe() -> tuple[int, str, str, str]:
    """One external fetch of the Hub URL. Returns (curl_rc, http_code, remote_ip, err)."""
    resolve = os.environ.get("FUNNEL_WATCH_RESOLVE")
    cmd = ["curl", "-sS", "-o", "/dev/null", "--max-time", "20",
           "-w", "%{http_code} %{remote_ip}"]
    cmd += ["--resolve", resolve] if resolve else ["--doh-url", DOH_URL]
    cmd.append(URL)
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
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
        return {"status": "HEALTHY", "consecutive_fails": 0, "alerted": False}


def save_state(st: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(st, indent=2) + "\n")
    tmp.replace(STATE_FILE)


def read_webhook() -> str:
    for line in (REPO / ".env.local").read_text().splitlines():
        if line.startswith(ENV_VAR + "="):
            v = line.split("=", 1)[1].strip()
            if v:
                return v
    raise RuntimeError(f"{ENV_VAR} missing/empty in .env.local — cannot alert")


def alert(msg: str) -> bool:
    if os.environ.get("FUNNEL_WATCH_DRY_RUN") == "1":
        print(f"[DRY_RUN] would post: {msg}")
        return True
    resp = requests.post(read_webhook(), json={"content": msg}, timeout=15)
    return resp.status_code in (200, 204)


def main() -> int:
    verdict, detail = classify()
    st = load_state()
    prev = st.get("status", "HEALTHY")
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
        st["status"] = "HEALTHY"
    elif verdict == "DEAD":
        st["consecutive_fails"] = int(st.get("consecutive_fails", 0)) + 1
        if st["consecutive_fails"] >= FAILS_TO_ALERT:
            if not st.get("alerted"):  # state-change only — one 🚨, retried until a POST lands
                try:
                    st["alerted"] = bool(alert(DOWN_MSG.format(fails=st["consecutive_fails"], detail=detail)))
                    st["last_alert"] = utcnow()
                except Exception as e:
                    print(f"alert failed: {e}", file=sys.stderr)
                    st["alerted"] = False
            st["status"] = "DEAD"
        # below threshold: grace window — status unchanged, no alert
    else:  # UNKNOWN — this box's connectivity or a self-resolve; never an edge verdict
        st["status"] = prev

    save_state(st)
    print(f"{utcnow()} funnel-edge-watch verdict={verdict} status={st['status']} "
          f"fails={st.get('consecutive_fails', 0)} {detail}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
