"""Hub API helper — queries download_manager for file listing and operations.

Invoked by /api/intel/downloads/{list,archive,unarchive,delete,path}.
READ + WRITE: archive/unarchive/delete mutate the manifest. archive/unarchive
move files between active/ and archive/; delete removes the file from disk, the
manifest, and the #downloads Discord message. List/path are READ-ONLY.

REL-04 (2026-06-02): the import + dispatch is wrapped in an outer try/except so
any throw from download_manager (import error, list_downloads/get_stats/
archive_file raising) yields a single fail-safe JSON object + exit 0 instead of
a non-zero exit → route 500. Loud fail-open: the error is surfaced in `error`.
The bad-input branches use sys.exit(0) (raises SystemExit, NOT caught by the
`except Exception` guard, so their explicit JSON is preserved).

Usage:
    python3 query_downloads.py list [all|active|archived]
    python3 query_downloads.py archive <filename>
    python3 query_downloads.py unarchive <filename>
    python3 query_downloads.py delete <filename>
    python3 query_downloads.py path <filename>
"""
import json
import sys

sys.path.insert(0, "/home/trevor/trevor")

try:
    from download_manager import (  # noqa: E402
        archive_file,
        delete_download,
        get_file_path,
        get_stats,
        list_downloads,
        unarchive_file,
    )

    action = sys.argv[1] if len(sys.argv) > 1 else "list"

    if action == "list":
        filter_status = sys.argv[2] if len(sys.argv) > 2 else "all"
        if filter_status not in ("all", "active", "archived"):
            print(json.dumps({"error": f"invalid filter: {filter_status}"}))
            sys.exit(0)
        files = list_downloads(filter_status)
        stats = get_stats()
        print(json.dumps({"files": files, "stats": stats, "filter": filter_status}))

    elif action == "archive":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "archive requires filename"}))
            sys.exit(0)
        filename = sys.argv[2]
        result = archive_file(filename)
        print(json.dumps({"success": bool(result), "filename": filename}))

    elif action == "unarchive":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "unarchive requires filename"}))
            sys.exit(0)
        filename = sys.argv[2]
        result = unarchive_file(filename)
        print(json.dumps({"success": bool(result), "filename": filename}))

    elif action == "delete":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "delete requires filename"}))
            sys.exit(0)
        filename = sys.argv[2]
        result = delete_download(filename)
        print(json.dumps({
            "success": bool(result.get("deleted")),
            "filename": filename,
            "discord_deleted": bool(result.get("discord_deleted")),
            "error": result.get("error"),
        }))

    elif action == "path":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "path requires filename"}))
            sys.exit(0)
        filename = sys.argv[2]
        path = get_file_path(filename)
        print(json.dumps({"path": path, "filename": filename}))

    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))

except Exception as e:  # noqa: BLE001 — never crash the route; surface the error
    print(json.dumps({"error": str(e), "files": [], "stats": {}, "success": False}))
    sys.exit(0)
