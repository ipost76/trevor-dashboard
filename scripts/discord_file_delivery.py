#!/usr/bin/env python3
"""
Report-delivery pipeline for the TrevorHub WSL box  [W-C-P2-DELIVERY].

Posts a file to the Discord #downloads channel via the hub's OWN webhook and
registers it in the downloads manifest (through download_manager.save_download)
so it surfaces in the Hub DOCS zone — the WSL-side mirror of the VM pipeline.

HARD SEPARATION RULE
--------------------
The webhook URL is read ONLY from `.env.local` as HUB_DOWNLOADS_WEBHOOK_URL.
It is NEVER hardcoded, NEVER printed, and there is NO fallback to the bot's
webhook or token. If the var is missing/empty, post_file_sync() raises loudly.

This is machine-local delivery on WSL. It does NOT touch the VM, the bot, or
the live trevor.db.

CLI:
    python3 scripts/discord_file_delivery.py <filepath> [title] [description]
API:
    from scripts.discord_file_delivery import post_file_sync
    post_file_sync(filepath, title=None, description=None, category=None)
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Import download_manager (ported to the repo root) regardless of how this script
# is invoked — `import download_manager` needs the repo root on sys.path because
# this file lives in scripts/.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import download_manager  # noqa: E402

ENV_VAR = "HUB_DOWNLOADS_WEBHOOK_URL"
ENV_FILE = _REPO_ROOT / ".env.local"
TIMEOUT_SECONDS = 30

# --- Delivery format V2 (DELIVERY_FORMAT_V2) --------------------------------
# Same flag name as the VM path ([B2]) so Ghost flips ONE concept for both boxes.
# Default OFF -> the embed is byte-identical to the legacy shape below. ON ->
# a standard delivery: title (resolved) + ET date/time, prose description dropped.
DELIVERY_FORMAT_V2_ENV = "DELIVERY_FORMAT_V2"
EMBED_COLOR = 0x5FB4CC  # refined cyan-soft, matches the hub aesthetic
TITLE_CAP = 256  # Discord embed title limit
DESC_CAP = 4096  # Discord embed description limit
_H1_READ_BYTES = 8192  # bounded read — never slurp a large file to find a heading
ET_ZONE = "America/New_York"


def _format_v2_enabled() -> bool:
    """True only when DELIVERY_FORMAT_V2 is explicitly truthy. Fail-closed OFF."""
    try:
        val = (os.environ.get(DELIVERY_FORMAT_V2_ENV) or "").strip().lower()
    except Exception:
        return False
    return val in ("1", "true", "yes", "on")


def _extract_h1(src: Path) -> str | None:
    """Return the file's first Markdown H1 (`# Heading`), else None.

    Size-bounded (reads at most _H1_READ_BYTES) and fully error-handled — a
    binary, empty, unreadable, or heading-less file returns None and NEVER
    raises. Title extraction must never break a delivery.
    """
    try:
        with src.open("r", encoding="utf-8", errors="strict") as fh:
            head = fh.read(_H1_READ_BYTES)
    except Exception:
        return None
    for line in head.splitlines():
        stripped = line.strip()
        # exactly one leading '#' + a space (ATX H1, not '##'/'###')
        if stripped.startswith("# "):
            heading = stripped[2:].strip()
            if heading:
                return heading
    return None


def _is_clean_title(title: str | None) -> bool:
    """Clean caller-title = present, single-line, within the title cap.

    Concrete rule (B3): no newline AND len <= TITLE_CAP -> clean; otherwise
    fall through to the file's H1. Guards against a prose blob mistakenly
    passed as the title (the description was historically the prose slot).
    """
    if not title:
        return False
    t = title.strip()
    return bool(t) and "\n" not in t and len(t) <= TITLE_CAP


def _resolve_title(title: str | None, src: Path, basename: str) -> str:
    """Fallback chain: clean caller title -> file H1 -> filename (sans ext)."""
    if _is_clean_title(title):
        return (title or "").strip()  # guard guarantees truthy; keeps type-checker happy
    h1 = _extract_h1(src)
    if h1:
        return h1
    return src.stem or basename


def _delivery_timestamp_et() -> str:
    """Post-time in Eastern, explicit ET, DST-robust (stdlib zoneinfo).

    Matches the two-clock ET display convention; renders the SAME text on any
    reader's screen (unlike Discord's native `timestamp`, which localizes).
    """
    from datetime import datetime
    from zoneinfo import ZoneInfo

    return datetime.now(ZoneInfo(ET_ZONE)).strftime("%Y-%m-%d %I:%M %p ET")


def _compose_embed(
    title: str | None, description: str | None, basename: str, src: Path
) -> dict:
    """Build the Discord embed.

    OFF (default) -> byte-identical to the legacy embed dict.
    ON (DELIVERY_FORMAT_V2 truthy) -> title (resolved) + ET date/time; the
    prose `description` is IGNORED (kept in the signature; callers unchanged).
    """
    if _format_v2_enabled():
        return {
            "title": _resolve_title(title, src, basename)[:TITLE_CAP],
            "description": _delivery_timestamp_et()[:DESC_CAP],
            "color": EMBED_COLOR,
        }
    # OFF: exact legacy shape — do not change these literals.
    return {
        "title": (title or basename)[:256],
        "description": (description or "")[:4096],
        "color": 0x5FB4CC,  # refined cyan-soft, matches the hub aesthetic
    }


def _read_webhook_url() -> str:
    """Return the hub's #downloads webhook URL from .env.local.

    Read order: process env first (so a caller can export it), then .env.local.
    Raises RuntimeError if missing/empty — NEVER falls back to any other webhook,
    NEVER returns the bot token. The value is never logged or printed.
    """
    val = (os.environ.get(ENV_VAR) or "").strip()
    if not val and ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, raw = line.partition("=")
            if key.strip() == ENV_VAR:
                raw = raw.strip()
                if (raw.startswith('"') and raw.endswith('"')) or (
                    raw.startswith("'") and raw.endswith("'")
                ):
                    raw = raw[1:-1]
                val = raw.strip()
                break
    if not val:
        raise RuntimeError(
            f"{ENV_VAR} is not set in {ENV_FILE} (or the environment). "
            f"Add the hub's #downloads webhook URL there. Refusing to post — "
            f"there is NO fallback to the bot webhook/token."
        )
    return val


def _with_wait(url: str) -> str:
    """Append wait=true so Discord returns the created message (incl. its id)."""
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}wait=true"


def post_file_sync(
    filepath: str,
    title: str | None = None,
    description: str | None = None,
    category: str | None = None,
) -> dict:
    """Post `filepath` to #downloads via the env webhook, then register it in the
    downloads manifest so the DOCS zone lists it.

    Returns a dict:
      {ok, status_code, message_id, filename, manifest_entry, error}
    - ok=True only when the webhook accepted the file (HTTP 200/204) AND the file
      was registered in the manifest.
    - Webhook 4xx/5xx → ok=False with status_code + error (does not raise).
    - Missing webhook env → raises RuntimeError (fail loud).
    - File not found → ok=False, error set (does not raise).
    """
    import requests  # local import — keeps module import cheap

    result: dict = {
        "ok": False,
        "status_code": None,
        "message_id": None,
        "filename": None,
        "manifest_entry": None,
        "error": None,
    }

    src = Path(filepath)
    if not src.exists() or not src.is_file():
        result["error"] = f"file not found: {filepath}"
        return result

    webhook_url = _read_webhook_url()  # raises if missing — intentional
    basename = src.name
    embed = _compose_embed(title, description, basename, src)
    payload = {"payload_json": json.dumps({"embeds": [embed]})}

    try:
        with src.open("rb") as fh:
            files = {"files[0]": (basename, fh, "application/octet-stream")}
            resp = requests.post(
                _with_wait(webhook_url),
                data=payload,
                files=files,
                timeout=TIMEOUT_SECONDS,
            )
    except requests.exceptions.Timeout:
        result["error"] = f"webhook timeout after {TIMEOUT_SECONDS}s"
        return result
    except requests.exceptions.RequestException as e:
        result["error"] = f"webhook request failed: {e}"
        return result

    result["status_code"] = resp.status_code
    if resp.status_code not in (200, 204):
        # Surface the failure; do not crash. Truncate body so a huge error page
        # can't flood the caller.
        result["error"] = f"webhook HTTP {resp.status_code}: {resp.text[:300]}"
        return result

    # Capture the created message id (only present with wait=true → 200 + body).
    message_id = None
    if resp.status_code == 200:
        try:
            message_id = resp.json().get("id")
        except Exception:
            message_id = None
    result["message_id"] = message_id

    # Register in the manifest via the real download_manager API (exact schema).
    # save_download copies the file into downloads/active/ and appends a manifest
    # entry (additive — never clobbers existing entries). Returns {} on failure.
    try:
        msg_id_int = int(message_id) if message_id is not None else None
    except (TypeError, ValueError):
        msg_id_int = None
    entry = download_manager.save_download(str(src), basename, discord_msg_id=msg_id_int)
    if not entry:
        # Posted to Discord but the manifest append failed — report honestly.
        result["error"] = "posted to #downloads but manifest registration failed"
        return result

    # Optional: assign to a category if one was requested and exists.
    if category:
        try:
            download_manager.move_file_to_category(entry["filename"], category)
            entry["category_id"] = category
        except Exception as e:  # non-fatal — file is delivered + listed
            result["error"] = f"delivered + listed, but category assign failed: {e}"

    result["ok"] = True
    result["filename"] = entry.get("filename")
    result["manifest_entry"] = entry
    return result


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(
            json.dumps(
                {"ok": False, "error": "usage: discord_file_delivery.py <filepath> [title] [description]"}
            )
        )
        return 2
    filepath = argv[1]
    title = argv[2] if len(argv) > 2 else None
    description = argv[3] if len(argv) > 3 else None
    try:
        out = post_file_sync(filepath, title=title, description=description)
    except RuntimeError as e:
        # Missing webhook env — fail loud, non-zero exit, never print the URL.
        print(json.dumps({"ok": False, "error": str(e)}))
        return 3
    print(json.dumps(out, indent=2))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
