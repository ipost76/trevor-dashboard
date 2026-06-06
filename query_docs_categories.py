"""Hub API helper — category management + category-filtered download listing.

Invoked by the /api/docs/categories/* routes and the ?category= filter on
/api/intel/downloads. WRITE: create / rename / delete / reorder categories
and file-move mutate downloads/categories.json or downloads/manifest.json
through download_manager (atomic tmp-rename writes, thread-locked).
categories-list and list-by-category are READ-ONLY.

Usage:
    python3 query_docs_categories.py categories-list
    python3 query_docs_categories.py category-create <name>
    python3 query_docs_categories.py category-rename <id> <new_name>
    python3 query_docs_categories.py category-delete <id>
    python3 query_docs_categories.py category-reorder <json_id_array>
    python3 query_docs_categories.py file-move <filename> <json_category_id>
    python3 query_docs_categories.py list-by-category <id|uncategorized> [status]

Always prints exactly one JSON object to stdout and exits 0; callers inspect
the JSON (success / error / category keys), never the process exit code.
"""
import json
import os
import sys

# W-C-P2-DELIVERY: import download_manager from this script's own directory (the
# dashboard repo root, where download_manager.py was ported) instead of the
# VM-hardcoded /home/trevor/trevor path, which holds only the read-only replica.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from download_manager import (  # noqa: E402
    create_category,
    delete_category,
    get_stats,
    list_downloads,
    list_downloads_by_category,
    load_categories,
    move_file_to_category,
    rename_category,
    reorder_categories,
)


def _uncategorized_count() -> int:
    """Count every manifest entry (active + archived) with no category."""
    return sum(1 for f in list_downloads() if f.get("category_id") is None)


def main() -> None:
    action = sys.argv[1] if len(sys.argv) > 1 else ""

    if action == "categories-list":
        print(json.dumps({
            "categories": load_categories(),
            "uncategorized_count": _uncategorized_count(),
        }))

    elif action == "category-create":
        if len(sys.argv) < 3 or not sys.argv[2].strip():
            print(json.dumps({"error": "category-create requires a non-empty name"}))
            return
        print(json.dumps({"category": create_category(sys.argv[2])}))

    elif action == "category-rename":
        if len(sys.argv) < 4 or not sys.argv[3].strip():
            print(json.dumps({"error": "category-rename requires <id> <new_name>"}))
            return
        category = rename_category(sys.argv[2], sys.argv[3])
        if category is None:
            print(json.dumps({"error": "category not found", "id": sys.argv[2]}))
            return
        print(json.dumps({"category": category}))

    elif action == "category-delete":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "category-delete requires <id>"}))
            return
        category_id = sys.argv[2]
        # Count files in the category BEFORE deleting — delete_category moves
        # them all to Uncategorized, so the count must be taken first.
        files_moved = len(list_downloads_by_category(category_id, include_archived=True))
        success = delete_category(category_id)
        print(json.dumps({
            "success": success,
            "files_moved": files_moved if success else 0,
        }))

    elif action == "category-reorder":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "category-reorder requires a JSON id array"}))
            return
        try:
            ids = json.loads(sys.argv[2])
        except json.JSONDecodeError as e:
            print(json.dumps({"error": f"invalid JSON id array: {e}"}))
            return
        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
            print(json.dumps({"error": "category-reorder expects an array of string ids"}))
            return
        print(json.dumps({"success": reorder_categories(ids)}))

    elif action == "file-move":
        if len(sys.argv) < 4:
            print(json.dumps({"error": "file-move requires <filename> <json_category_id>"}))
            return
        try:
            category_id = json.loads(sys.argv[3])
        except json.JSONDecodeError as e:
            print(json.dumps({"error": f"invalid JSON category_id: {e}"}))
            return
        if category_id is not None and not isinstance(category_id, str):
            print(json.dumps({"error": "category_id must be a string or null"}))
            return
        print(json.dumps({"success": move_file_to_category(sys.argv[2], category_id)}))

    elif action == "list-by-category":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "list-by-category requires <id|uncategorized>"}))
            return
        cat_arg = sys.argv[2]
        status = sys.argv[3] if len(sys.argv) > 3 else "all"
        if status not in ("all", "active", "archived"):
            status = "all"
        category_id = None if cat_arg == "uncategorized" else cat_arg
        files = list_downloads_by_category(
            category_id, include_archived=(status != "active")
        )
        if status == "archived":
            files = [f for f in files if f.get("archived")]
        print(json.dumps({
            "files": files,
            "stats": get_stats(),
            "filter": status,
            "category": cat_arg,
        }))

    else:
        print(json.dumps({"error": f"unknown action: {action}"}))


if __name__ == "__main__":
    # OUTER-WRAP: 2026-05-27 (silent-crash visibility)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        try:
            main()
        except Exception as e:  # never crash — always emit JSON for the route
            print(json.dumps({"error": f"query_docs_categories failed: {e}"}))

    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
