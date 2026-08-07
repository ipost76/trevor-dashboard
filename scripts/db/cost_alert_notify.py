#!/usr/bin/env python3
"""cost_alert_notify.py — anti-spam guard + Discord post for the GCP budget alert (B5).

Reads ONE JSON object from stdin describing an over-threshold month-end forecast and,
IF it should fire today, posts it to **#qa-agent** through the ONE shared WSL alert
ladder (`scripts/alert_delivery.post_alert`).

🚨 M15 / B6-ALERTS — WHY THIS ONE NEEDED A DIFFERENT FIX FROM ITS THREE SIBLINGS. The
other WSL posters all called `funnel_edge_watch.resolve_webhook()`, which already PREFERS
#qa-agent and merely lacked the bot-token tier. This one never touched that resolver at
all: it read `discord_file_delivery._read_webhook_url()`, which is HUB_DOWNLOADS-only,
env-only, with no QA preference and no fallback — so it was **structurally incapable of
reaching #qa-agent even if HUB_QA_WEBHOOK_URL were minted**. A resolver-level fix could
never have moved it. A runaway cloud bill is an OPS WARNING, not an artefact, and it does
not belong in the file-delivery channel.

`#downloads` keeps its file role: `discord_file_delivery` / `deliver_report` are
untouched and still deliver reports there. Only this ALERT moved.

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

# The embed (ALERT_COLOR / EMBED_TITLE / TIMEOUT_SECONDS) is gone with the downloads-only
# POST: the alert is now a house-shaped CONTENT message delivered by alert_delivery, which
# owns the HTTP timeout. Severity is carried by the ⚠️ DEGRADED badge, not by a hex colour.


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _out(d: dict) -> int:
    print(json.dumps(d))
    return 0


def _build_alert(projected: float, threshold: float, top, mtd, month_label, month_end=None):
    """House-shaped builder: (channel_label, note) -> content string.

    The forward RUN-RATE that crossed the threshold, the driving service, the honest
    month-end, and a nudge to the Hub cost card. Plain and direct, no filler.

    `projected` is the forward run-rate projection (trailing-window daily mean ×
    days-in-month) — NOT the sunk month-to-date. That's the B1 change: an already-ENDED
    spike (run-rate back to normal) no longer fires; a real ongoing spike still does.
    """
    if SCRIPTS_DIR not in sys.path:
        sys.path.insert(0, SCRIPTS_DIR)
    from alert_delivery import SEV_DEGRADED, house_alert  # noqa: E402

    facts = []
    if month_end is not None:
        try:
            facts.append(f"this month's projected total: ${float(month_end):,.2f}")
        except (TypeError, ValueError):
            pass
    if isinstance(top, dict) and top.get("service"):
        try:
            ntl = float(top.get("net_usd") or 0.0)
        except (TypeError, ValueError):
            ntl = 0.0
        facts.append(f"top service: {top['service']} (${ntl:,.2f} MTD)")
    if mtd is not None:
        try:
            ml = f" ({month_label})" if month_label else ""
            facts.append(f"month-to-date: ${float(mtd):,.2f}{ml}")
        except (TypeError, ValueError):
            pass

    def build(channel_label: str, note: str | None) -> str:
        f = list(facts)
        if note:
            f.append(note)
        return house_alert(
            SEV_DEGRADED,
            f"GCP spend is on pace for ${projected:,.2f}/mo — over the "
            f"${threshold:,.2f} alert threshold",
            f,
            "Check the Hub cost card: /health?tab=cost",
            f"cost_alert_notify · sent to {channel_label}",
        )

    return build


def _deliver(build):
    """Post through the shared ladder. Returns (ok, message_id, error). Never raises here —
    post_alert never raises; the caller's try/except stays as belt-and-braces.

    ⚠️ `message_id` is now always None. The old path appended `?wait=true` to a webhook to
    read the id back; the ladder may deliver over bot-token REST instead, where that query
    param does not apply. The key is KEPT rather than removed — `src/lib/cost-alert.ts`
    declares it optional and branches on `alerted`/`reason` only (checked), and deleting a
    machine contract is unrecoverable while an unused field costs nothing.
    """
    if SCRIPTS_DIR not in sys.path:
        sys.path.insert(0, SCRIPTS_DIR)
    from alert_delivery import post_alert  # noqa: E402

    res = post_alert(lambda label, note: {"content": build(label, note)},
                     source="GCP budget alert")
    if res.ok:
        return (True, None, None)
    return (False, None, f"delivery failed via {res.label}: {res.detail or 'no detail'}")


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
    month_end = data.get("month_end")  # honest month-end forecast (display context; optional)
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

    build = _build_alert(projected, threshold, top, mtd, month_label, month_end)

    if dry_run:
        return _out({"alerted": False, "reason": "dry_run", "would_post": True,
                     "preview": build("#qa-agent (dry-run)", None), **base})

    # 3. Post (best-effort). ANY failure → no date recorded → retried next refresh.
    try:
        ok, message_id, err = _deliver(build)
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
