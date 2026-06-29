"""
Download Manager — persistent file storage for TREVOR deliveries.

Files are saved under the dashboard repo's downloads/ tree (W-C-P2-DELIVERY:
repo-relative, env-overridable via HUB_DOWNLOADS_DIR) with two subdirectories:
- active/   → files within the 7-day retention window (auto-cleaned)
- archive/  → permanently saved files (never auto-deleted)

A manifest.json tracks metadata for all files. A categories.json holds
folder definitions; each manifest entry carries a category_id field
(null = Uncategorized).

Thread-safe: a module-level lock guards all manifest read-modify-write
cycles + filesystem moves. Atomic writes via tmp-rename so a crash
mid-write cannot corrupt the manifest.

All timestamps are Eastern Time (America/New_York) via tz_utils.now_et.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

try:
    from loguru import logger
except Exception:  # W-C-P2-DELIVERY: loguru isn't installed on the WSL hub.
    # Minimal stdlib fallback (mirrors the tz_utils fallback below) so this
    # module ports cleanly without adding a logging dependency. Schema logic
    # is untouched — only the logger sink changes.
    import logging as _logging

    _logging.basicConfig(level=_logging.WARNING, format="%(asctime)s %(message)s")
    logger = _logging.getLogger("download_manager")  # type: ignore[assignment]

try:
    from tz_utils import now_et
except Exception:  # pragma: no cover — fallback only matters if tz_utils breaks
    def now_et():  # type: ignore[no-redef]
        return datetime.now(timezone(timedelta(hours=-4)))


# W-C-P2-DELIVERY: ported to the WSL hub. The downloads tree lives beside this
# module in the dashboard repo (env-overridable via HUB_DOWNLOADS_DIR) instead of
# the VM-hardcoded /home/trevor/trevor/downloads. Resolved off __file__ so the
# dashboard (runPython) and the delivery script agree on one path regardless of cwd.
DOWNLOADS_DIR = Path(
    os.environ.get("HUB_DOWNLOADS_DIR")
    or (Path(__file__).resolve().parent / "downloads")
)
ACTIVE_DIR = DOWNLOADS_DIR / "active"
ARCHIVE_DIR = DOWNLOADS_DIR / "archive"
MANIFEST_PATH = DOWNLOADS_DIR / "manifest.json"
CATEGORIES_PATH = DOWNLOADS_DIR / "categories.json"

_lock = threading.Lock()
_UNSAFE_CHARS = re.compile(r"[^a-z0-9._-]+")
_SLUG_STRIP = re.compile(r"[^a-z0-9-]+")

# Persistent fail-open log for Discord deletes. loguru's default sink is stderr,
# which the Hub's runPython subprocess DISCARDS on a clean (exit 0) delete — so a
# fail-open Discord-delete failure was previously invisible (the 2026-05-31 root
# cause: a stale Hub token 401'd and nobody saw it). This file sink records every
# failure regardless of how download_manager is invoked (bot OR Hub subprocess).
_DELETE_LOG_PATH = Path(
    os.environ.get("HUB_DOWNLOADS_LOG")
    or (Path(__file__).resolve().parent / "logs" / "downloads_delete.log")
)


def _persist_delete_log(msg: str) -> None:
    """Append a timestamped line to the persistent downloads-delete log.

    Best-effort: never raises into the delete path. This is the LOUD half of the
    fail-open contract — fail-open stays (it never blocks the local delete) but it
    can never be silent again.
    """
    try:
        _DELETE_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        ts = now_et().isoformat()
        with _DELETE_LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(f"{ts} {msg}\n")
    except Exception:
        pass

# Sentinel default for list_downloads_by_category — lets it tell "no category
# argument given" (return everything) apart from an explicit None (return only
# Uncategorized downloads).
_UNSET = object()


# ── auto-delete kill switch ──────────────────────────────────────────────────
# Permanently False. Ghost requires manual delete only — the #downloads file
# store is Ghost-curated and must never lose files to a background cleanup.
# The 2026-05-20 wave removed the Docs archive UI (categories replaced it), so
# the archive-as-protection mechanism is gone — and the auto-delete path it
# protected files from must also stay permanently off. cleanup_expired() is
# guarded at the function entry by this flag; scripts/cleanup_downloads.sh is
# a no-op early-exit; and trevor-downloads-cleanup.timer is disabled.
# hooks/guard_recurring_bugs.sh Bug #15 fails if this is flipped back to True.
DOWNLOADS_AUTO_DELETE_ENABLED = False


# ── internals ────────────────────────────────────────────────────────────────

def _ensure_dirs() -> None:
    ACTIVE_DIR.mkdir(parents=True, exist_ok=True)
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)


def _load_manifest() -> list[dict]:
    if not MANIFEST_PATH.exists():
        return []
    try:
        with MANIFEST_PATH.open("r") as fh:
            data = json.load(fh)
        if isinstance(data, list):
            return data
        logger.warning(f"[DOWNLOADS] manifest is not a list ({type(data).__name__}); resetting")
        return []
    except json.JSONDecodeError as e:
        logger.warning(f"[DOWNLOADS] manifest JSON decode failed; resetting: {e}")
        return []
    except Exception as e:
        logger.warning(f"[DOWNLOADS] manifest load failed: {e}")
        return []


def _save_manifest(entries: list[dict]) -> None:
    _ensure_dirs()
    tmp = MANIFEST_PATH.with_suffix(".json.tmp")
    with tmp.open("w") as fh:
        json.dump(entries, fh, indent=2)
    os.replace(tmp, MANIFEST_PATH)


def _load_categories() -> list[dict]:
    if not CATEGORIES_PATH.exists():
        return []
    try:
        with CATEGORIES_PATH.open("r") as fh:
            data = json.load(fh)
        if isinstance(data, list):
            return data
        logger.warning(
            f"[DOWNLOADS] categories is not a list ({type(data).__name__}); resetting"
        )
        return []
    except json.JSONDecodeError as e:
        logger.warning(f"[DOWNLOADS] categories JSON decode failed; resetting: {e}")
        return []
    except Exception as e:
        logger.warning(f"[DOWNLOADS] categories load failed: {e}")
        return []


def _save_categories(categories: list[dict]) -> None:
    _ensure_dirs()
    tmp = CATEGORIES_PATH.with_suffix(".json.tmp")
    with tmp.open("w") as fh:
        json.dump(categories, fh, indent=2)
    os.replace(tmp, CATEGORIES_PATH)


def _sanitize_filename(name: str) -> str:
    """Lowercase, replace unsafe chars (incl. whitespace) with '_', collapse."""
    if not name:
        return "unnamed"
    sanitized = _UNSAFE_CHARS.sub("_", name.lower())
    sanitized = re.sub(r"_+", "_", sanitized).strip("_.")
    return sanitized or "unnamed"


def _resolve_unique_name(base_name: str) -> str:
    """Return a filename unique within active/, appending _2/_3/... on collision."""
    if not (ACTIVE_DIR / base_name).exists():
        return base_name
    p = Path(base_name)
    stem = p.stem
    suffix = p.suffix
    i = 2
    while True:
        candidate = f"{stem}_{i}{suffix}"
        if not (ACTIVE_DIR / candidate).exists():
            return candidate
        i += 1


def _slugify(name: str) -> str:
    """Lowercase slug for a category id: lowercase, whitespace -> hyphen,
    drop everything outside [a-z0-9-], collapse repeats, trim hyphens.
    May return '' for a name with no usable characters — callers handle that.
    """
    slug = re.sub(r"\s+", "-", (name or "").strip().lower())
    slug = _SLUG_STRIP.sub("", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug


# ── public API ───────────────────────────────────────────────────────────────

def save_download(
    source_path: str,
    original_name: str,
    discord_msg_id: int | None = None,
) -> dict:
    """Copy file to active/, register in manifest, return entry dict.

    Filename pattern: {YYYY-MM-DD}_{sanitized_stem}{lowercased_ext}.
    Duplicate basenames append _2, _3, ... within active/.
    Returns {} on any failure (never raises) so callers can fail-open.
    """
    with _lock:
        _ensure_dirs()
        src = Path(source_path)
        if not src.exists() or not src.is_file():
            logger.warning(f"[DOWNLOADS] save_download: source not found: {source_path}")
            return {}

        # original_name may contain path traversal — keep only the basename
        orig_basename = Path(original_name).name
        orig_path = Path(orig_basename)
        ext_lower = orig_path.suffix.lower()
        stem_sanitized = _sanitize_filename(orig_path.stem)

        ts = now_et()
        date_prefix = ts.strftime("%Y-%m-%d")
        base_filename = f"{date_prefix}_{stem_sanitized}{ext_lower}"
        filename = _resolve_unique_name(base_filename)

        dst = ACTIVE_DIR / filename
        try:
            shutil.copy2(src, dst)
        except Exception as e:
            logger.warning(f"[DOWNLOADS] save_download: copy failed {src} -> {dst}: {e}")
            return {}

        try:
            size_bytes = dst.stat().st_size
        except Exception:
            size_bytes = 0

        entry = {
            "filename": filename,
            "original_name": orig_basename,
            "created_at": ts.isoformat(),
            "size_bytes": size_bytes,
            "archived": False,
            "archived_at": None,
            "discord_msg_id": int(discord_msg_id) if discord_msg_id else None,
            "file_type": ext_lower.lstrip("."),
            "category_id": None,
        }
        entries = _load_manifest()
        entries.append(entry)
        try:
            _save_manifest(entries)
        except Exception as e:
            logger.warning(f"[DOWNLOADS] save_download: manifest write failed: {e}")
            # file is on disk but unindexed — best-effort, leave file in place
            return {}

        logger.warning(
            f"[DOWNLOADS] Saved {filename} "
            f"({size_bytes} bytes, msg_id={discord_msg_id})"
        )
        return entry


def archive_file(filename: str) -> bool:
    """Move file from active/ to archive/ and mark archived in manifest.

    Idempotent: if already archived, returns True without filesystem action.
    Returns False if the file is unknown or missing from active/.
    """
    with _lock:
        _ensure_dirs()
        entries = _load_manifest()
        target = next((e for e in entries if e.get("filename") == filename), None)
        if target is None:
            logger.warning(f"[DOWNLOADS] archive_file: {filename} not in manifest")
            return False
        if target.get("archived"):
            return True  # idempotent — already archived

        src = ACTIVE_DIR / filename
        if not src.exists():
            logger.warning(f"[DOWNLOADS] archive_file: {filename} missing from active/")
            return False
        dst = ARCHIVE_DIR / filename
        try:
            shutil.move(str(src), str(dst))
        except Exception as e:
            logger.warning(f"[DOWNLOADS] archive_file: move failed: {e}")
            return False

        target["archived"] = True
        target["archived_at"] = now_et().isoformat()
        try:
            _save_manifest(entries)
        except Exception as e:
            logger.warning(f"[DOWNLOADS] archive_file: manifest write failed: {e}")
            return False
        logger.warning(f"[DOWNLOADS] Archived {filename}")
        return True


def unarchive_file(filename: str) -> bool:
    """Move file from archive/ back to active/ and clear archived flag.

    Idempotent: if already in active/, returns True. Returns False on missing.
    """
    with _lock:
        _ensure_dirs()
        entries = _load_manifest()
        target = next((e for e in entries if e.get("filename") == filename), None)
        if target is None:
            logger.warning(f"[DOWNLOADS] unarchive_file: {filename} not in manifest")
            return False
        if not target.get("archived"):
            return True  # idempotent — already active

        src = ARCHIVE_DIR / filename
        if not src.exists():
            logger.warning(f"[DOWNLOADS] unarchive_file: {filename} missing from archive/")
            return False
        dst = ACTIVE_DIR / filename
        try:
            shutil.move(str(src), str(dst))
        except Exception as e:
            logger.warning(f"[DOWNLOADS] unarchive_file: move failed: {e}")
            return False

        target["archived"] = False
        target["archived_at"] = None
        try:
            _save_manifest(entries)
        except Exception as e:
            logger.warning(f"[DOWNLOADS] unarchive_file: manifest write failed: {e}")
            return False
        logger.warning(f"[DOWNLOADS] Unarchived {filename}")
        return True


def _delete_discord_message(message_id: int) -> tuple[bool, Optional[str]]:
    """Best-effort deletion of a #downloads Discord message via the REST API.

    Returns (ok, reason). ok is True if the message is gone (HTTP 200/204, or
    404 — already gone); False on any other outcome. `reason` is None on success,
    else a short failure string (also written to the persistent delete log).
    Never raises: Discord cleanup is best-effort so delete_download() can still
    report the file itself as deleted.

    Credentials are read AUTHORITATIVELY from the bot's own .env via
    load_dotenv(override=True). When this module is imported inside the Hub's
    dashboard process (via runPython), that process injects its OWN — possibly
    stale — DISCORD_BOT_TOKEN. override=True guarantees the bot's current, valid
    token + channel win, so a stale Hub token can never cause a silent 401 (the
    2026-05-31 root cause). For the bot process this is idempotent (same .env).

    `requests` / `dotenv` are imported lazily so the module's base import set
    (and every existing caller) is unaffected.
    """
    try:
        import requests
        from dotenv import load_dotenv

        load_dotenv(Path(__file__).resolve().parent / ".env", override=True)
        token = os.getenv("DISCORD_BOT_TOKEN", "").strip()
        channel_id = os.getenv("DOWNLOADS_CHANNEL_ID", "").strip() or "1492922559019225261"
        if not token:
            reason = "DISCORD_BOT_TOKEN not set — skipping Discord cleanup"
            logger.warning(f"[DOWNLOADS] delete: {reason}")
            _persist_delete_log(f"FAIL msg_id={message_id} reason={reason}")
            return False, reason

        url = f"https://discord.com/api/v10/channels/{channel_id}/messages/{message_id}"
        headers = {
            "Authorization": f"Bot {token}",
            "User-Agent": "TREVOR-FileDelivery/1.0 (+https://trevor-prime.com)",
        }
        resp = requests.delete(url, headers=headers, timeout=10)

        # 429 rate limit: respect retry_after (body, then Retry-After header),
        # sleep, and retry ONCE. A second 429 (or any other failure) falls
        # through to the generic fail-open handling below. Clamped to [0.5, 10]s
        # so a hostile/garbled retry_after can't stall the Hub request.
        if resp.status_code == 429:
            import time

            # Prefer the JSON body's retry_after (Discord always sends it on
            # 429); fall back to the Retry-After header if the body lacks the
            # key or isn't parseable JSON; default to 1s as a last resort.
            retry_after = None
            try:
                retry_after = resp.json().get("retry_after")
            except Exception:
                retry_after = None
            if retry_after is None:
                retry_after = resp.headers.get("Retry-After", 1)
            try:
                retry_after = float(retry_after)
            except Exception:
                retry_after = 1.0
            retry_after = max(0.5, min(retry_after, 10.0))
            logger.warning(
                f"[DOWNLOADS] delete: rate limited (429) on {message_id}; "
                f"retrying once after {retry_after:.2f}s"
            )
            time.sleep(retry_after)
            resp = requests.delete(url, headers=headers, timeout=10)

        if resp.status_code in (200, 204):
            logger.warning(f"[DOWNLOADS] delete: Discord message {message_id} deleted")
            return True, None
        if resp.status_code == 404:
            logger.warning(
                f"[DOWNLOADS] delete: Discord message {message_id} already gone (404)"
            )
            return True, None
        reason = f"HTTP {resp.status_code}: {resp.text[:200]}"
        logger.warning(
            f"[DOWNLOADS] delete: Discord delete failed for {message_id} — {reason}"
        )
        _persist_delete_log(
            f"FAIL msg_id={message_id} channel={channel_id} reason={reason}"
        )
        return False, reason
    except Exception as e:
        reason = f"exception: {e}"
        logger.warning(
            f"[DOWNLOADS] delete: Discord delete raised for {message_id} "
            f"(non-fatal — file already removed): {e}"
        )
        _persist_delete_log(f"FAIL msg_id={message_id} reason={reason}")
        return False, reason


def delete_download(filename: str) -> dict:
    """Permanently delete a download — remove it from disk, the manifest, and
    the #downloads Discord channel.

    Returns {"deleted": bool, "discord_deleted": bool, "error": str | None}.

    The file may live in either active/ or archive/ — both are checked.
    Fail-open on Discord: the file is removed from disk + manifest first, then
    the Discord message is deleted best-effort. A Discord failure still reports
    deleted=True (the file itself is gone); discord_deleted records only the
    cleanup outcome. A file already missing from disk is still un-indexed.
    """
    discord_msg_id: int | None = None
    with _lock:
        _ensure_dirs()
        entries = _load_manifest()
        target = next((e for e in entries if e.get("filename") == filename), None)
        if target is None:
            logger.warning(f"[DOWNLOADS] delete_download: {filename} not in manifest")
            return {"deleted": False, "discord_deleted": False, "error": "not found"}

        discord_msg_id = target.get("discord_msg_id")

        # File may live in archive/ or active/ — check archive/ first.
        disk_path: Optional[Path] = None
        for directory in (ARCHIVE_DIR, ACTIVE_DIR):
            candidate = directory / filename
            if candidate.exists():
                disk_path = candidate
                break

        if disk_path is not None:
            # Safety guard (defense-in-depth): confirm the resolved target is
            # inside the downloads root before unlinking, so a crafted filename
            # can never delete a file elsewhere on the box. This is local to the
            # unlink and independent of the route-level (/, ..) reject + the
            # manifest-membership gate above — belt-and-suspenders for a write
            # surface the read-only lockdown deliberately reopened.
            root = DOWNLOADS_DIR.resolve()
            resolved = disk_path.resolve()
            if root not in resolved.parents:
                logger.warning(
                    f"[DOWNLOADS] delete_download: REFUSED {filename} — resolved "
                    f"path {resolved} is outside downloads root {root}"
                )
                return {"deleted": False, "discord_deleted": False,
                        "error": "refused: path outside downloads root"}
            try:
                disk_path.unlink()
            except Exception as e:
                logger.warning(
                    f"[DOWNLOADS] delete_download: unlink failed for {disk_path}: {e}"
                )
                return {"deleted": False, "discord_deleted": False,
                        "error": f"unlink failed: {e}"}
        else:
            # Disk copy already gone — still prune the dangling manifest entry.
            logger.warning(
                f"[DOWNLOADS] delete_download: {filename} missing from disk; "
                f"pruning manifest entry"
            )

        remaining = [e for e in entries if e.get("filename") != filename]
        try:
            _save_manifest(remaining)
        except Exception as e:
            logger.warning(f"[DOWNLOADS] delete_download: manifest write failed: {e}")
            return {"deleted": False, "discord_deleted": False,
                    "error": f"manifest write failed: {e}"}

    # Lock released — the file + manifest entry are gone. Discord cleanup is
    # best-effort and must not hold the manifest lock across a network call.
    discord_deleted = False
    discord_error: Optional[str] = None
    if discord_msg_id is not None:
        try:
            discord_deleted, discord_error = _delete_discord_message(int(discord_msg_id))
        except Exception as e:  # e.g. a non-numeric msg id in the manifest
            discord_error = f"discord cleanup skipped: {e}"
            logger.warning(f"[DOWNLOADS] delete_download: {discord_error}")
            _persist_delete_log(f"FAIL filename={filename} reason={discord_error}")
    else:
        # No id in the manifest → the Discord message can't be auto-deleted.
        # Loud, not silent (this is one of the two failure modes the 2026-05-31
        # audit had to rule out).
        discord_error = "no discord_msg_id in manifest — Discord message not auto-deleted"
        logger.warning(f"[DOWNLOADS] delete_download: {filename} — {discord_error}")
        _persist_delete_log(f"FAIL filename={filename} reason={discord_error}")

    logger.warning(
        f"[DOWNLOADS] Deleted {filename} "
        f"(discord_deleted={discord_deleted}, msg_id={discord_msg_id}, "
        f"discord_error={discord_error})"
    )
    return {
        "deleted": True,
        "discord_deleted": discord_deleted,
        "error": None,
        "discord_error": discord_error,
    }


def list_downloads(filter_status: str = "all") -> list[dict]:
    """Return manifest entries sorted newest first. filter: all|active|archived."""
    entries = _load_manifest()
    if filter_status == "active":
        entries = [e for e in entries if not e.get("archived")]
    elif filter_status == "archived":
        entries = [e for e in entries if e.get("archived")]
    entries.sort(key=lambda e: e.get("created_at") or "", reverse=True)
    return entries


def get_file_path(filename: str) -> Optional[str]:
    """Return absolute filesystem path for filename. Checks archive/ first."""
    arch = ARCHIVE_DIR / filename
    if arch.exists():
        return str(arch)
    act = ACTIVE_DIR / filename
    if act.exists():
        return str(act)
    return None


def cleanup_expired(days: int = 7) -> int:
    """Delete non-archived files in active/ older than `days`. NEVER touches archive/.

    Reads created_at from manifest; removes both the file and its manifest entry.
    Files whose disk copy is already missing are still pruned from the manifest.
    Returns the count of files removed from disk.

    PERMANENTLY DISABLED (2026-05-20) — gated by DOWNLOADS_AUTO_DELETE_ENABLED
    at the top of this module. Ghost requires manual delete only. The body
    below is retained intact (additive principle) but is unreachable at
    runtime; calling this function early-returns 0 and logs a warning.
    """
    if not DOWNLOADS_AUTO_DELETE_ENABLED:
        logger.warning(
            "[DOWNLOADS] Download auto-delete is permanently disabled — "
            "manual delete only (DOWNLOADS_AUTO_DELETE_ENABLED=False)"
        )
        return 0
    with _lock:
        _ensure_dirs()
        entries = _load_manifest()
        cutoff = now_et() - timedelta(days=days)
        deleted = 0
        kept: list[dict] = []
        for e in entries:
            # Archive is sacred — always preserve, regardless of age
            if e.get("archived"):
                kept.append(e)
                continue
            created_iso = e.get("created_at")
            if not created_iso:
                kept.append(e)
                continue
            try:
                created = datetime.fromisoformat(created_iso)
            except Exception:
                kept.append(e)
                continue
            if created >= cutoff:
                kept.append(e)
                continue
            # Old enough to purge
            filename = e.get("filename", "")
            path = ACTIVE_DIR / filename
            try:
                if path.exists():
                    path.unlink()
                    deleted += 1
                    logger.warning(
                        f"[DOWNLOADS] Cleanup deleted {filename} "
                        f"(created {created_iso}, > {days}d old)"
                    )
                else:
                    logger.warning(
                        f"[DOWNLOADS] Cleanup: {filename} already missing from active/; "
                        f"removing from manifest"
                    )
                # Either way, drop from manifest (file is gone OR was never there)
            except Exception as ex:
                logger.warning(f"[DOWNLOADS] Cleanup unlink failed for {filename}: {ex}")
                kept.append(e)  # keep in manifest if we couldn't delete
        if deleted or len(kept) != len(entries):
            try:
                _save_manifest(kept)
            except Exception as e:
                logger.warning(f"[DOWNLOADS] cleanup_expired: manifest write failed: {e}")
        return deleted


def get_stats() -> dict:
    """Return {active_count, archive_count, total_size_mb}."""
    entries = _load_manifest()
    active = sum(1 for e in entries if not e.get("archived"))
    archived = sum(1 for e in entries if e.get("archived"))
    total_bytes = sum(int(e.get("size_bytes") or 0) for e in entries)
    return {
        "active_count": active,
        "archive_count": archived,
        "total_size_mb": round(total_bytes / (1024 * 1024), 2),
    }


# ── categories ───────────────────────────────────────────────────────────────

def load_categories() -> list[dict]:
    """Load categories from categories.json, sorted by sort_order ascending.

    Returns an empty list if the file is missing, empty, or unreadable.
    """
    cats = _load_categories()
    cats.sort(key=lambda c: c.get("sort_order", 0))
    return cats


def save_categories(categories: list[dict]) -> None:
    """Write the categories list to categories.json with an atomic
    write-to-tmp-then-rename. Takes the shared lock so it is safe to call
    alongside any other download_manager operation.
    """
    with _lock:
        _save_categories(categories)


def create_category(name: str) -> dict:
    """Create a new category and persist it.

    The id is an auto-generated slug of `name`, de-duplicated with a
    -2/-3/... suffix on collision. The category is appended with the next
    sort_order. Returns the new category dict.
    """
    with _lock:
        cats = _load_categories()
        base_id = _slugify(name) or "category"
        existing_ids = {c.get("id") for c in cats}
        new_id = base_id
        n = 2
        while new_id in existing_ids:
            new_id = f"{base_id}-{n}"
            n += 1
        next_order = max(
            (int(c.get("sort_order", 0)) for c in cats), default=0
        ) + 1
        category = {
            "id": new_id,
            "name": (name or "").strip(),
            "sort_order": next_order,
            "created_at": now_et().isoformat(),
        }
        cats.append(category)
        _save_categories(cats)
        logger.warning(
            f"[DOWNLOADS] Created category {new_id!r} ({category['name']!r})"
        )
        return category


def rename_category(category_id: str, new_name: str) -> dict | None:
    """Rename a category in place. The id is NEVER changed — only `name`.

    Returns the updated category dict, or None if no category has that id.
    """
    with _lock:
        cats = _load_categories()
        target = next((c for c in cats if c.get("id") == category_id), None)
        if target is None:
            logger.warning(f"[DOWNLOADS] rename_category: {category_id!r} not found")
            return None
        target["name"] = (new_name or "").strip()
        _save_categories(cats)
        logger.warning(
            f"[DOWNLOADS] Renamed category {category_id!r} -> {target['name']!r}"
        )
        return target


def delete_category(category_id: str) -> bool:
    """Delete a category; its files move to Uncategorized (category_id None).

    Returns True if the category existed and was deleted, False otherwise.
    Files are reassigned (manifest write) BEFORE the category is removed
    (categories write), so an interrupted call can only orphan a category,
    never leave a file pointing at a deleted one.
    """
    with _lock:
        cats = _load_categories()
        if not any(c.get("id") == category_id for c in cats):
            logger.warning(f"[DOWNLOADS] delete_category: {category_id!r} not found")
            return False
        entries = _load_manifest()
        moved = 0
        for e in entries:
            if e.get("category_id") == category_id:
                e["category_id"] = None
                moved += 1
        if moved:
            _save_manifest(entries)
        remaining = [c for c in cats if c.get("id") != category_id]
        _save_categories(remaining)
        logger.warning(
            f"[DOWNLOADS] Deleted category {category_id!r} "
            f"({moved} file(s) -> Uncategorized)"
        )
        return True


def reorder_categories(category_ids: list[str]) -> bool:
    """Reorder categories: each category's sort_order is set from its
    position in `category_ids` (1-based).

    Returns True only if `category_ids` is exactly the current set of
    category ids (no missing, extra, or duplicate ids); otherwise nothing
    is written and False is returned.
    """
    with _lock:
        cats = _load_categories()
        current_ids = {c.get("id") for c in cats}
        if len(category_ids) != len(cats) or set(category_ids) != current_ids:
            logger.warning(
                f"[DOWNLOADS] reorder_categories: id-set mismatch "
                f"(got {category_ids})"
            )
            return False
        cats_by_id = {c.get("id"): c for c in cats}
        for position, cid in enumerate(category_ids, start=1):
            cats_by_id[cid]["sort_order"] = position
        cats.sort(key=lambda c: c.get("sort_order", 0))
        _save_categories(cats)
        logger.warning(f"[DOWNLOADS] Reordered categories: {category_ids}")
        return True


def move_file_to_category(filename: str, category_id: str | None) -> bool:
    """Assign a download to a category, or to Uncategorized when category_id
    is None.

    Returns True if the file was found and updated. Returns False if the
    file is not in the manifest, or category_id is a non-None id with no
    matching category (guards against dangling category references).
    """
    with _lock:
        if category_id is not None:
            known = any(
                c.get("id") == category_id for c in _load_categories()
            )
            if not known:
                logger.warning(
                    f"[DOWNLOADS] move_file_to_category: unknown category "
                    f"{category_id!r}"
                )
                return False
        entries = _load_manifest()
        target = next(
            (e for e in entries if e.get("filename") == filename), None
        )
        if target is None:
            logger.warning(
                f"[DOWNLOADS] move_file_to_category: {filename!r} not in manifest"
            )
            return False
        target["category_id"] = category_id
        _save_manifest(entries)
        logger.warning(
            f"[DOWNLOADS] Moved {filename!r} -> category {category_id!r}"
        )
        return True


def list_downloads_by_category(
    category_id=_UNSET, include_archived: bool = False
) -> list[dict]:
    """List downloads filtered by category, newest first.

    - category_id omitted  -> every download, each with a `category` key
      holding the resolved category dict (or None for Uncategorized).
    - category_id is None  -> only Uncategorized downloads.
    - category_id is a str -> only downloads whose category_id matches.

    Archived downloads are excluded unless include_archived is True. The
    annotated (omitted-argument) form returns shallow copies; manifest
    entries are never mutated.
    """
    entries = _load_manifest()
    if not include_archived:
        entries = [e for e in entries if not e.get("archived")]

    if category_id is not _UNSET:
        matches = [e for e in entries if e.get("category_id") == category_id]
        matches.sort(key=lambda e: e.get("created_at") or "", reverse=True)
        return matches

    cats_by_id = {c.get("id"): c for c in _load_categories()}
    annotated: list[dict] = []
    for e in entries:
        item = dict(e)
        item["category"] = cats_by_id.get(e.get("category_id"))
        annotated.append(item)
    annotated.sort(key=lambda e: e.get("created_at") or "", reverse=True)
    return annotated


__all__ = [
    "save_download",
    "archive_file",
    "unarchive_file",
    "delete_download",
    "list_downloads",
    "get_file_path",
    "cleanup_expired",
    "get_stats",
    "load_categories",
    "save_categories",
    "create_category",
    "rename_category",
    "delete_category",
    "reorder_categories",
    "move_file_to_category",
    "list_downloads_by_category",
]
