#!/usr/bin/env python3
"""
query_system_health.py — Self-probe system health collector for /api/memory/health.

Read-only. No restart/kill side-effects. Outputs a single JSON document with:
  - 3 service traffic-lights (trevor / trevor-dashboard / ghost-qa)
  - 11 collectors (cpu, memory, disk, network, db_size, db_writability,
                   vectordb_size, litestream, ghost_qa_heartbeat,
                   scanner_lag, autotrader_pulse)
  - last 10 WARNING+ sentinels from trevor.log (last 64KB tail)
  - killswitch state (EMERGENCY_KILLSWITCH from auto_config — NOT KILLSWITCH_ENABLED)

Tones: green (<70% for cpu/mem/disk), amber (70-90%), red (>90%).
Services: active=green, activating=amber, otherwise=red.

Defensive: every collector returns a degraded entry on error (never raises).
"""
import json
import os
import re
import sqlite3
import subprocess
from datetime import datetime, timezone

DB_PATH = "/home/trevor/trevor/trevor.db"
DB_RO_URI = f"file:{DB_PATH}?mode=ro"
TREVOR_LOG = "/home/trevor/trevor/logs/trevor.log"
VECTORDB_PATH = "/home/trevor/trevor/vectordb"
LOG_TAIL_BYTES = 64 * 1024
PING_TARGET = "1.1.1.1"


def _conn_ro() -> sqlite3.Connection:
    return sqlite3.connect(DB_RO_URI, uri=True, timeout=10)


def _tone_pct(pct: float) -> str:
    if pct < 70:
        return "green"
    if pct < 90:
        return "amber"
    return "red"


def _tone_service(state: str) -> str:
    if state == "active":
        return "green"
    if state == "activating" or state == "reloading":
        return "amber"
    return "red"


def _systemctl_state(unit: str) -> str:
    try:
        r = subprocess.run(
            ["systemctl", "is-active", unit],
            capture_output=True, timeout=2,
        )
        return (r.stdout.decode() or "").strip() or "unknown"
    except Exception:
        return "unknown"


def collect_cpu() -> dict:
    try:
        with open("/proc/loadavg") as f:
            load = f.read().split()
        load1 = float(load[0])
        with open("/proc/cpuinfo") as f:
            ncpu = f.read().count("processor\t:")
        ncpu = max(ncpu, 1)
        usage = min(100, max(0, int(load1 / ncpu * 100)))
        return {
            "key": "cpu", "label": "CPU",
            "status": "ok", "tone": _tone_pct(usage),
            "value": f"{usage}%",
            "detail": f"load1 {load1:.2f} / {ncpu} cores",
        }
    except Exception as e:
        return {"key": "cpu", "label": "CPU", "status": "error",
                "tone": "red", "value": "--", "detail": str(e)[:80]}


def collect_memory() -> dict:
    try:
        d = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                d[k.strip()] = int(v.split()[0])  # kB
        total = d.get("MemTotal", 0)
        avail = d.get("MemAvailable", d.get("MemFree", 0))
        used = total - avail
        pct = int(used / total * 100) if total else 0
        used_mb = used // 1024
        total_mb = total // 1024
        return {
            "key": "memory", "label": "Memory",
            "status": "ok", "tone": _tone_pct(pct),
            "value": f"{pct}%",
            "detail": f"{used_mb}MB / {total_mb}MB",
        }
    except Exception as e:
        return {"key": "memory", "label": "Memory", "status": "error",
                "tone": "red", "value": "--", "detail": str(e)[:80]}


def collect_disk() -> dict:
    try:
        s = os.statvfs("/")
        total = s.f_blocks * s.f_frsize
        free = s.f_bavail * s.f_frsize
        used = total - free
        pct = int(used / total * 100) if total else 0
        gb = lambda b: f"{b / (1024**3):.0f}GB"
        return {
            "key": "disk", "label": "Disk",
            "status": "ok", "tone": _tone_pct(pct),
            "value": f"{pct}%",
            "detail": f"{gb(used)} / {gb(total)}",
        }
    except Exception as e:
        return {"key": "disk", "label": "Disk", "status": "error",
                "tone": "red", "value": "--", "detail": str(e)[:80]}


def collect_network() -> dict:
    try:
        r = subprocess.run(
            ["ping", "-c", "1", "-W", "1", PING_TARGET],
            capture_output=True, timeout=3,
        )
        if r.returncode == 0:
            ms = "?"
            for tok in (r.stdout or b"").decode().split():
                if tok.startswith("time="):
                    ms = tok.split("=", 1)[1]
                    break
            return {
                "key": "network", "label": "Network",
                "status": "ok", "tone": "green",
                "value": "reachable",
                "detail": f"{PING_TARGET} time={ms}ms" if ms != "?" else PING_TARGET,
            }
        return {"key": "network", "label": "Network",
                "status": "down", "tone": "red",
                "value": "unreachable",
                "detail": f"ping {PING_TARGET} failed"}
    except Exception as e:
        return {"key": "network", "label": "Network", "status": "error",
                "tone": "amber", "value": "--", "detail": str(e)[:80]}


def collect_db_size() -> dict:
    try:
        size = os.path.getsize(DB_PATH)
        wal_path = DB_PATH + "-wal"
        wal = os.path.getsize(wal_path) if os.path.exists(wal_path) else 0
        return {
            "key": "db_size", "label": "DB Size",
            "status": "ok", "tone": "green",
            "value": f"{size / (1024**2):.0f}MB",
            "detail": f"trevor.db; WAL {wal / (1024**2):.1f}MB",
        }
    except Exception as e:
        return {"key": "db_size", "label": "DB Size", "status": "error",
                "tone": "red", "value": "--", "detail": str(e)[:80]}


def collect_db_writability() -> dict:
    # READ-ONLY probe: open a read-only connection, check journal mode + SELECT 1.
    # We do NOT test write here (would require RW connection; we don't want
    # G2 to introduce any unintended write paths).
    try:
        with _conn_ro() as conn:
            jm = conn.execute("PRAGMA journal_mode").fetchone()[0]
            ok = conn.execute("SELECT 1").fetchone()[0]
        return {
            "key": "db_writability", "label": "DB Health",
            "status": "ok", "tone": "green",
            "value": "OK",
            "detail": f"journal_mode={jm}; SELECT={ok}",
        }
    except Exception as e:
        return {"key": "db_writability", "label": "DB Health",
                "status": "error", "tone": "red",
                "value": "--", "detail": str(e)[:80]}


def collect_vectordb_size() -> dict:
    try:
        if not os.path.isdir(VECTORDB_PATH):
            return {"key": "vectordb_size", "label": "VectorDB",
                    "status": "missing", "tone": "amber",
                    "value": "--", "detail": "path not found"}
        total = 0
        for dirpath, _dirs, files in os.walk(VECTORDB_PATH):
            for f in files:
                try:
                    total += os.path.getsize(os.path.join(dirpath, f))
                except OSError:
                    pass
        return {
            "key": "vectordb_size", "label": "VectorDB",
            "status": "ok", "tone": "green",
            "value": f"{total / (1024**2):.0f}MB",
            "detail": "chroma persist",
        }
    except Exception as e:
        return {"key": "vectordb_size", "label": "VectorDB",
                "status": "error", "tone": "red",
                "value": "--", "detail": str(e)[:80]}


def collect_litestream() -> dict:
    state = _systemctl_state("litestream.service")
    return {
        "key": "litestream", "label": "Litestream",
        "status": state, "tone": _tone_service(state),
        "value": state,
        "detail": "WAL replication",
    }


def collect_ghost_qa() -> dict:
    state = _systemctl_state("ghost-qa.service")
    return {
        "key": "ghost_qa_heartbeat", "label": "Ghost-QA",
        "status": state, "tone": _tone_service(state),
        "value": state,
        "detail": "qa monitor",
    }


def _parse_ts(raw: str):
    """Parse ISO-ish timestamps with or without timezone suffix."""
    if not raw:
        return None
    raw = raw.strip().rstrip("Z")
    try:
        # ISO 8601 with optional offset
        dt = datetime.fromisoformat(raw)
    except ValueError:
        # try common 'YYYY-MM-DD HH:MM:SS'
        try:
            dt = datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def collect_scanner_lag() -> dict:
    """Scanner freshness via loop_heartbeat WHERE loop_name='scalp_scan_loop'."""
    try:
        with _conn_ro() as conn:
            row = conn.execute(
                "SELECT last_iteration_at, cadence_seconds FROM loop_heartbeat "
                "WHERE loop_name='scalp_scan_loop'"
            ).fetchone()
        if not row:
            return {"key": "scanner_lag", "label": "Scanner",
                    "status": "missing", "tone": "amber",
                    "value": "--", "detail": "no scalp_scan_loop row"}
        last_str, cadence = row
        last = _parse_ts(last_str)
        if last is None:
            return {"key": "scanner_lag", "label": "Scanner",
                    "status": "error", "tone": "amber",
                    "value": "--", "detail": f"unparsed ts: {last_str!r}"}
        delta = (datetime.now(timezone.utc) - last).total_seconds()
        cadence = int(cadence or 180)
        if delta < cadence * 2:
            tone = "green"
        elif delta < cadence * 5:
            tone = "amber"
        else:
            tone = "red"
        return {
            "key": "scanner_lag", "label": "Scanner Lag",
            "status": "ok", "tone": tone,
            "value": f"{int(delta)}s",
            "detail": f"cadence {cadence}s",
        }
    except Exception as e:
        return {"key": "scanner_lag", "label": "Scanner Lag",
                "status": "error", "tone": "red",
                "value": "--", "detail": str(e)[:80]}


def collect_autotrader_pulse() -> dict:
    try:
        with _conn_ro() as conn:
            row = conn.execute(
                "SELECT value FROM auto_config WHERE key='AUTO_LIVE_ENABLED'"
            ).fetchone()
        if not row:
            return {"key": "autotrader_pulse", "label": "AutoTrader",
                    "status": "unknown", "tone": "amber",
                    "value": "--", "detail": "no AUTO_LIVE_ENABLED"}
        enabled = (row[0] or "false").strip().lower() == "true"
        return {
            "key": "autotrader_pulse", "label": "AutoTrader",
            "status": "on" if enabled else "off",
            "tone": "green" if enabled else "amber",
            "value": "LIVE" if enabled else "OFF",
            "detail": "AUTO_LIVE_ENABLED",
        }
    except Exception as e:
        return {"key": "autotrader_pulse", "label": "AutoTrader",
                "status": "error", "tone": "red",
                "value": "--", "detail": str(e)[:80]}


def collect_services() -> list:
    out = []
    for name in ("trevor.service", "trevor-dashboard.service", "ghost-qa.service"):
        state = _systemctl_state(name)
        out.append({"name": name, "status": state, "tone": _tone_service(state)})
    return out


def collect_killswitch_enabled() -> bool:
    try:
        with _conn_ro() as conn:
            row = conn.execute(
                "SELECT value FROM auto_config WHERE key='EMERGENCY_KILLSWITCH'"
            ).fetchone()
        return bool(row) and (row[0] or "false").strip().lower() == "true"
    except Exception:
        return False


_TS_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2})")
_TAG_RE = re.compile(r"\[([A-Z][A-Z0-9_-]*)\]")
_LEVELS = ("WARNING", "ERROR", "CRITICAL")


def collect_sentinels() -> list:
    """Tail last 64KB of trevor.log, return last 10 WARNING+/ERROR/CRITICAL lines."""
    try:
        if not os.path.exists(TREVOR_LOG):
            return []
        size = os.path.getsize(TREVOR_LOG)
        with open(TREVOR_LOG, "rb") as f:
            f.seek(max(0, size - LOG_TAIL_BYTES))
            data = f.read().decode("utf-8", errors="replace")
        lines = data.splitlines()
        if not lines:
            return []
        # Drop a possibly-truncated leading line (the seek may land mid-line).
        if size > LOG_TAIL_BYTES:
            lines = lines[1:]
        out = []
        for line in lines:
            level = None
            for lv in _LEVELS:
                if f"| {lv} |" in line:
                    level = lv
                    break
            if not level:
                continue
            ts_match = _TS_RE.match(line)
            ts = ts_match.group(1) if ts_match else None
            tag_match = _TAG_RE.search(line)
            tag = tag_match.group(1) if tag_match else "GENERIC"
            # Message: drop the "TS | LEVEL |" prefix if present.
            try:
                msg = line.split("|", 2)[2].strip()
            except IndexError:
                msg = line.strip()
            out.append({
                "ts": ts,
                "level": level,
                "tag": tag,
                "message": msg[:240],
            })
        return out[-10:]
    except Exception:
        return []


def main() -> None:
    snapshot_at = datetime.now(timezone.utc).isoformat()
    payload = {
        "snapshot_at": snapshot_at,
        "killswitch_enabled": collect_killswitch_enabled(),
        "services": collect_services(),
        "collectors": [
            collect_cpu(),
            collect_memory(),
            collect_disk(),
            collect_network(),
            collect_db_size(),
            collect_db_writability(),
            collect_vectordb_size(),
            collect_litestream(),
            collect_ghost_qa(),
            collect_scanner_lag(),
            collect_autotrader_pulse(),
        ],
        "sentinels": collect_sentinels(),
        "source": "self-probe",
        "stale_seconds": None,
    }
    for c in payload["collectors"]:
        c.setdefault("as_of", snapshot_at)
    print(json.dumps(payload, default=str))


if __name__ == "__main__":
    # OUTER-WRAP: 2026-05-27 (silent-crash visibility)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        main()

    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
