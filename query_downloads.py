"""Hub API helper — queries download_manager for file listing and operations.

Invoked by /api/intel/downloads/{list,archive,unarchive,path}.
READ + WRITE: archive/unarchive mutate the manifest + move files between
active/ and archive/. List/path are READ-ONLY.

Usage:
    python3 query_downloads.py list [all|active|archived]
    python3 query_downloads.py archive <filename>
    python3 query_downloads.py unarchive <filename>
    python3 query_downloads.py path <filename>
"""
import json
import sys

sys.path.insert(0, "/home/trevor/trevor")

from download_manager import (  # noqa: E402
    archive_file,
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

elif action == "path":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "path requires filename"}))
        sys.exit(0)
    filename = sys.argv[2]
    path = get_file_path(filename)
    print(json.dumps({"path": path, "filename": filename}))

else:
    print(json.dumps({"error": f"Unknown action: {action}"}))
