#!/usr/bin/env python3
"""
deliver_report.py — finalize a WSL report by delivering it to Discord #downloads.

This is the single entry point WSL report-gen should call when a report is
finalized: it delivers the file to #downloads and registers it in the downloads
manifest, so the report no longer just sits on disk. It is a thin wrapper over
`scripts/discord_file_delivery.post_file_sync()` — the sender, webhook handling,
and manifest registration already exist; this only adds the missing CALL plus a
safety net.

CONVENTION (CLAUDE.md, 2026-06-08): "finalizing a WSL report = call
deliver_report". Reports are written ad-hoc into docs/, so there is no central
report-gen function to hook; call this when a report is done and it auto-delivers.

SAFETY
------
The webhook URL is read by post_file_sync() ONLY from .env.local as
HUB_DOWNLOADS_WEBHOOK_URL (env-only, fail-loud, NO bot-token fallback) and is
never printed. As defence-in-depth, this wrapper additionally SCRUBS any Discord
webhook URL that could leak into an error string — `requests` connection errors
embed the full failing URL (including the token) — before returning/printing.
The original report is left at its disk path on any failure, so nothing is lost.

CLI:
    python3 scripts/deliver_report.py <filepath> [title] [description]
API:
    from scripts.deliver_report import deliver_report
    result = deliver_report(filepath, title=None, description=None)
    # result: {ok, status_code, message_id, filename, manifest_entry, error}
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# This lives in scripts/. Put both the scripts dir (for the sibling import below)
# and the repo root (for the sender's own `import download_manager`) on sys.path.
_SCRIPTS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _SCRIPTS_DIR.parent
for _p in (_REPO_ROOT, _SCRIPTS_DIR):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from discord_file_delivery import post_file_sync  # noqa: E402  # type: ignore[reportMissingImports]  (resolved via sys.path above)

# Matches discord(app).com webhook URLs (incl. canary/ptb + /api/vN), greedily to
# the end of the token so the secret can never survive into printed output.
_WEBHOOK_RE = re.compile(
    r"https?://(?:canary\.|ptb\.)?discord(?:app)?\.com/api(?:/v\d+)?/webhooks/\S+",
    re.IGNORECASE,
)


def _scrub(value: str | None) -> str | None:
    """Redact any Discord webhook URL embedded in a string (defence-in-depth)."""
    if isinstance(value, str):
        return _WEBHOOK_RE.sub("[REDACTED_WEBHOOK]", value)
    return value


def deliver_report(
    filepath: str,
    title: str | None = None,
    description: str | None = None,
) -> dict:
    """Deliver a finalized WSL report to Discord #downloads.

    Returns the same dict as post_file_sync() — {ok, status_code, message_id,
    filename, manifest_entry, error} — with any `error` string scrubbed of webhook
    URLs. Re-raises RuntimeError (fail-loud) if the webhook env var is missing,
    matching the underlying sender's contract; the file stays on disk regardless.
    """
    result = post_file_sync(filepath, title=title, description=description)
    if result.get("error"):
        result["error"] = _scrub(result["error"])
    return result


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(
            json.dumps(
                {"ok": False, "error": "usage: deliver_report.py <filepath> [title] [description]"}
            )
        )
        return 2
    filepath = argv[1]
    title = argv[2] if len(argv) > 2 else None
    description = argv[3] if len(argv) > 3 else None
    try:
        result = deliver_report(filepath, title=title, description=description)
    except RuntimeError as e:
        # Missing webhook env — fail loud, non-zero exit, never print the URL.
        print(json.dumps({"ok": False, "error": _scrub(str(e))}))
        return 3
    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
