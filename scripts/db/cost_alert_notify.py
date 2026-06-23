#!/usr/bin/env python3
"""cost_alert_notify.py — anti-spam guard + Discord post for the GCP budget alert (B5).

Reads ONE JSON object from stdin describing an over-threshold month-end forecast and,
IF it should fire today, posts an embed to the Hub's #downloads channel via
HUB_DOWNLOADS_WEBHOOK_URL — reusing discord_file_delivery._read_webhook_url (env-only,
fail-loud, never printed, NO fallback). The webhook value is never logged.

ANTI-SPAM: at most ONE alert per UTC day. The date is recorded in data/hub.db
(cost_alert_state, single row id=1) ONLY AFTER a successful post — so a webhook failure
leaves the date untouched and the next refresh retries. An empty/absent state row means
"never alerted".

NEVER raises: always prints ONE JSON object and exits 0, so the caller (the cost-refresh
route, via src/lib/cost-alert.ts) can treat the whole alert as strictly best-effort — a
failure here can never break the daily refresh or the Hub.

stdin JSON:
  {projected, threshold, top_service:{service,net_usd}|null, mtd_total_usd, month_label}

flags:
  --dry-run   run every gate + build the embed, but DO NOT post and DO NOT record the
              date (returns reason 'dry_run'). For tests — never touches Discord or state.

stdout JSON:
  {alerted, reason, projected?, threshold?, top_service?, message_id?, would_post?, error?}
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HUB_DB = os.path.join(REPO_ROOT, "data", "hub.db")
REPLICA = "/home/ghost/trevor-replica/trevor.db"
SCRIPTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../scripts

ALERT_COLOR = 0xD4A64A  # refined gold — a warning, not an error (matches the hub aesthetic)
EMBED_TITLE = "⚠️ GCP budget alert"
TIMEOUT_SECONDS = 20


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _out(d: dict) -> int:
    print(json.dumps(d))
    return 0


def _build_embed(projected: float, threshold: float, top, mtd, month_label) -> dict:
    """Clear, actionable budget-alert embed — what's projected, the threshold it crossed,
    the driving service, and a nudge to the Hub cost card. Plain and direct, no filler."""
    lines = [
        f"GCP spend projected at **${projected:,.2f}** by month-end.",
        f"Alert threshold: **${threshold:,.2f}**.",
    ]
    if isinstance(top, dict) and top.get("service"):
        try:
            ntl = float(top.get("net_usd") or 0.0)
        except (TypeError, ValueError):
            ntl = 0.0
        lines.append(f"Top service: **{top['service']}** (${ntl:,.2f} MTD).")
    if mtd is not None:
        try:
            ml = f" ({month_label})" if month_label else ""
            lines.append(f"Month-to-date: ${float(mtd):,.2f}{ml}.")
        except (TypeError, ValueError):
            pass
    lines.append("→ Check the Hub cost card: **/health?tab=cost**")
    return {"title": EMBED_TITLE, "description": "\n".join(lines), "color": ALERT_COLOR}


def _post_embed(embed: dict):
    """Post an embed-only message to #downloads. Returns (ok, message_id, error).

    Reuses discord_file_delivery._read_webhook_url (the proven env-only, fail-loud,
    no-leak, no-fallback reader). post_file_sync itself can't be reused — it requires
    a FILE (and would register a manifest entry in the DOCS zone); a budget alert is a
    message, so this is a trivial embed-only POST against the same webhook.
    """
    import requests  # local import — keeps the gate paths free of the dep

    if SCRIPTS_DIR not in sys.path:
        sys.path.insert(0, SCRIPTS_DIR)
    import discord_file_delivery as dfd  # noqa: E402 — reuse the webhook reader

    url = dfd._read_webhook_url()  # raises RuntimeError if missing — caught by caller
    sep = "&" if "?" in url else "?"
    resp = requests.post(
        f"{url}{sep}wait=true",
        json={"embeds": [embed]},
        timeout=TIMEOUT_SECONDS,
    )
    if resp.status_code not in (200, 204):
        return (False, None, f"webhook HTTP {resp.status_code}: {resp.text[:200]}")
    message_id = None
    if resp.status_code == 200:
        try:
            message_id = resp.json().get("id")
        except Exception:  # noqa: BLE001
            message_id = None
    return (True, message_id, None)


def main(argv) -> int:
    dry_run = "--dry-run" in argv

    try:
        data = json.load(sys.stdin)
    except Exception as e:  # noqa: BLE001 — any malformed stdin is a clean no-alert
        return _out({"alerted": False, "reason": "bad_stdin", "error": str(e)[:200]})
    if not isinstance(data, dict):
        return _out({"alerted": False, "reason": "bad_input", "error": "stdin not an object"})

    raw_proj = data.get("projected")
    raw_thr = data.get("threshold")
    if raw_proj is None or raw_thr is None:
        return _out({"alerted": False, "reason": "bad_input", "error": "missing projected/threshold"})
    try:
        projected = float(raw_proj)
        threshold = float(raw_thr)
    except (TypeError, ValueError) as e:
        return _out({"alerted": False, "reason": "bad_input", "error": str(e)[:200]})

    top = data.get("top_service") if isinstance(data.get("top_service"), dict) else None
    mtd = data.get("mtd_total_usd")
    month_label = data.get("month_label")
    base = {
        "projected": round(projected, 2),
        "threshold": round(threshold, 2),
        "top_service": (top.get("service") if top else None),
    }

    # 1. Defensive threshold gate (the orchestrator already checked — belt + suspenders).
    if not (projected > threshold):
        return _out({"alerted": False, "reason": "under_threshold", **base})

    # 2. Anti-spam gate: one alert per UTC day. Read state (RO).
    if os.path.abspath(HUB_DB) == os.path.abspath(REPLICA):
        return _out({"alerted": False, "reason": "refused_replica_path", **base})
    if not os.path.exists(HUB_DB):
        return _out({"alerted": False, "reason": "hub_db_missing", **base})

    today = _today_utc()
    try:
        ro = sqlite3.connect(f"file:{HUB_DB}?mode=ro", uri=True)
        try:
            row = ro.execute(
                "SELECT last_alert_date FROM cost_alert_state WHERE id=1"
            ).fetchone()
            last_date = row[0] if row else None
        finally:
            ro.close()
    except sqlite3.Error as e:
        # State unreadable (e.g. migration 002 not applied) → fail SAFE: do NOT post.
        # Never spam when anti-spam can't be enforced.
        return _out({"alerted": False, "reason": "state_unreadable", "error": str(e)[:200], **base})

    if last_date == today:
        return _out({"alerted": False, "reason": "already_alerted_today", **base})

    embed = _build_embed(projected, threshold, top, mtd, month_label)

    if dry_run:
        return _out({"alerted": False, "reason": "dry_run", "would_post": True, **base})

    # 3. Post (best-effort). ANY failure → no date recorded → retried next refresh.
    try:
        ok, message_id, err = _post_embed(embed)
    except Exception as e:  # noqa: BLE001 — missing webhook (RuntimeError), network, anything
        return _out({"alerted": False, "reason": "post_failed", "error": str(e)[:200], **base})
    if not ok:
        return _out({"alerted": False, "reason": "post_failed", "error": err, **base})

    # 4. Record the date ONLY after a successful post (the anti-spam latch).
    try:
        rw = sqlite3.connect(HUB_DB, isolation_level=None)
        try:
            rw.execute("PRAGMA busy_timeout=5000;")
            rw.execute(
                "INSERT INTO cost_alert_state "
                "  (id, last_alert_date, last_forecast_usd, last_threshold_usd, updated_at) "
                "VALUES (1, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET "
                "  last_alert_date=excluded.last_alert_date, "
                "  last_forecast_usd=excluded.last_forecast_usd, "
                "  last_threshold_usd=excluded.last_threshold_usd, "
                "  updated_at=excluded.updated_at",
                (today, round(projected, 2), round(threshold, 2), _now_iso()),
            )
        finally:
            rw.close()
    except sqlite3.Error as e:
        # Posted but couldn't record — report honestly. A same-day re-refresh could
        # then double-post; acceptable vs. silently dropping a real alert.
        return _out({
            "alerted": True, "reason": "posted_record_failed",
            "message_id": message_id, "error": str(e)[:200], **base,
        })

    return _out({"alerted": True, "reason": "posted", "message_id": message_id, **base})


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
