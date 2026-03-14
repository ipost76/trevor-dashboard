#!/usr/bin/env python3
"""Portfolio management helper for Mission Control dashboard. READ-WRITE."""
import sqlite3, json, sys, os, time
from datetime import datetime

KNOWN_CRYPTO = {"BTC", "ETH", "SOL", "HYPE", "FARTCOIN", "DOGE", "AVAX", "LINK", "ADA", "DOT", "XRP"}
KNOWN_ETFS = {"SPY", "QQQ", "IWM", "DIA", "ARKK", "XLF", "XLE", "XLK", "GLD", "SLV", "TLT", "VTI", "VOO"}


def detect_asset_type(ticker):
    """Auto-detect asset type from ticker symbol."""
    upper = ticker.upper()
    if upper.endswith("-PERP"):
        return "crypto_perp"
    base = upper.replace("/", "").replace("-", "")
    if base in KNOWN_CRYPTO or any(base.startswith(c) for c in KNOWN_CRYPTO):
        return "crypto_spot"
    if upper in KNOWN_ETFS:
        return "etf"
    return "stock"


def ensure_table(conn):
    """Create portfolio_positions table if it does not exist."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS portfolio_positions (
            id INTEGER PRIMARY KEY,
            ticker TEXT NOT NULL,
            direction TEXT NOT NULL DEFAULT 'long',
            entry_price REAL NOT NULL,
            exit_price REAL,
            quantity REAL NOT NULL DEFAULT 1,
            leverage REAL NOT NULL DEFAULT 1,
            asset_type TEXT NOT NULL DEFAULT 'stock',
            status TEXT NOT NULL DEFAULT 'open',
            pnl_pct REAL,
            pnl_usd REAL,
            notes TEXT,
            tags TEXT,
            opened_at TEXT,
            closed_at TEXT
        )
    """)


def cmd_list(conn):
    """List all portfolio positions ordered by opened_at descending."""
    rows = conn.execute(
        "SELECT * FROM portfolio_positions ORDER BY opened_at DESC"
    ).fetchall()
    positions = [dict(r) for r in rows]
    print(json.dumps({"positions": positions}))


def cmd_add(conn, args):
    """Add a new portfolio position.

    args: ticker direction entry_price quantity leverage asset_type notes
    """
    if len(args) < 3:
        print(json.dumps({"error": "Required: ticker direction entry_price"}))
        return

    ticker = args[0].upper()
    direction = args[1].lower()
    try:
        entry_price = float(args[2])
    except ValueError:
        print(json.dumps({"error": f"Invalid entry_price: {args[2]}"}))
        return

    if direction not in ("long", "short"):
        print(json.dumps({"error": f"Invalid direction: {direction}. Must be 'long' or 'short'"}))
        return

    if entry_price <= 0:
        print(json.dumps({"error": "entry_price must be positive"}))
        return

    quantity = float(args[3]) if len(args) > 3 else 1.0
    leverage = float(args[4]) if len(args) > 4 else 1.0
    asset_type_raw = args[5] if len(args) > 5 else "auto"
    notes = args[6] if len(args) > 6 else ""

    if quantity <= 0:
        print(json.dumps({"error": "quantity must be positive"}))
        return

    if leverage <= 0:
        print(json.dumps({"error": "leverage must be positive"}))
        return

    asset_type = detect_asset_type(ticker) if asset_type_raw == "auto" else asset_type_raw
    position_id = int(time.time() * 1000)
    opened_at = datetime.now().isoformat()

    try:
        conn.execute(
            """INSERT INTO portfolio_positions
               (id, ticker, direction, entry_price, quantity, leverage, asset_type, status, notes, opened_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)""",
            (position_id, ticker, direction, entry_price, quantity, leverage, asset_type, notes, opened_at),
        )
        conn.commit()
        print(json.dumps({
            "ok": True,
            "id": position_id,
            "ticker": ticker,
            "direction": direction,
            "entry_price": entry_price,
            "quantity": quantity,
            "leverage": leverage,
            "asset_type": asset_type,
            "opened_at": opened_at,
        }))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


def cmd_update(conn, args):
    """Update fields on an existing position.

    args: id fields_json
    """
    if len(args) < 2:
        print(json.dumps({"error": "Required: id fields_json"}))
        return

    try:
        position_id = int(args[0])
    except ValueError:
        print(json.dumps({"error": f"Invalid id: {args[0]}"}))
        return

    try:
        fields = json.loads(args[1])
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON for fields: {e}"}))
        return

    if not fields:
        print(json.dumps({"error": "No fields to update"}))
        return

    # Whitelist of updatable columns to prevent injection
    allowed_columns = {
        "ticker", "direction", "entry_price", "exit_price", "quantity",
        "leverage", "asset_type", "status", "pnl_pct", "pnl_usd",
        "notes", "tags", "opened_at", "closed_at",
    }
    invalid_cols = set(fields.keys()) - allowed_columns
    if invalid_cols:
        print(json.dumps({"error": f"Invalid columns: {', '.join(invalid_cols)}"}))
        return

    # Verify position exists
    existing = conn.execute(
        "SELECT id FROM portfolio_positions WHERE id = ?", (position_id,)
    ).fetchone()
    if not existing:
        print(json.dumps({"error": f"Position {position_id} not found"}))
        return

    set_clauses = []
    values = []
    for col, val in fields.items():
        set_clauses.append(f"{col} = ?")
        values.append(val)

    values.append(position_id)

    try:
        conn.execute(
            f"UPDATE portfolio_positions SET {', '.join(set_clauses)} WHERE id = ?",
            values,
        )
        conn.commit()

        row = conn.execute(
            "SELECT * FROM portfolio_positions WHERE id = ?", (position_id,)
        ).fetchone()
        print(json.dumps({"ok": True, "position": dict(row) if row else None}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


def cmd_close(conn, args):
    """Close a position with exit price and calculate P&L.

    args: id exit_price
    """
    if len(args) < 2:
        print(json.dumps({"error": "Required: id exit_price"}))
        return

    try:
        position_id = int(args[0])
    except ValueError:
        print(json.dumps({"error": f"Invalid id: {args[0]}"}))
        return

    try:
        exit_price = float(args[1])
    except ValueError:
        print(json.dumps({"error": f"Invalid exit_price: {args[1]}"}))
        return

    if exit_price <= 0:
        print(json.dumps({"error": "exit_price must be positive"}))
        return

    row = conn.execute(
        "SELECT * FROM portfolio_positions WHERE id = ?", (position_id,)
    ).fetchone()

    if not row:
        print(json.dumps({"error": f"Position {position_id} not found"}))
        return

    position = dict(row)

    if position["status"] == "closed":
        print(json.dumps({"error": f"Position {position_id} is already closed"}))
        return

    entry_price = position["entry_price"]
    direction = position["direction"]
    leverage = position["leverage"] or 1.0
    quantity = position["quantity"] or 1.0

    direction_mult = 1.0 if direction == "long" else -1.0
    pnl_pct = ((exit_price - entry_price) / entry_price * direction_mult * leverage) * 100
    pnl_usd = (pnl_pct / 100) * entry_price * quantity

    pnl_pct = round(pnl_pct, 4)
    pnl_usd = round(pnl_usd, 4)
    closed_at = datetime.now().isoformat()

    try:
        conn.execute(
            """UPDATE portfolio_positions
               SET status = 'closed', exit_price = ?, pnl_pct = ?, pnl_usd = ?,
                   closed_at = ?
               WHERE id = ?""",
            (exit_price, pnl_pct, pnl_usd, closed_at, position_id),
        )
        conn.commit()

        updated = conn.execute(
            "SELECT * FROM portfolio_positions WHERE id = ?", (position_id,)
        ).fetchone()
        print(json.dumps({"ok": True, "position": dict(updated) if updated else None}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


def cmd_remove(conn, args):
    """Delete a position by id.

    args: id
    """
    if len(args) < 1:
        print(json.dumps({"error": "Required: id"}))
        return

    try:
        position_id = int(args[0])
    except ValueError:
        print(json.dumps({"error": f"Invalid id: {args[0]}"}))
        return

    existing = conn.execute(
        "SELECT id FROM portfolio_positions WHERE id = ?", (position_id,)
    ).fetchone()
    if not existing:
        print(json.dumps({"error": f"Position {position_id} not found"}))
        return

    try:
        conn.execute("DELETE FROM portfolio_positions WHERE id = ?", (position_id,))
        conn.commit()
        print(json.dumps({"ok": True, "removed": position_id}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


def cmd_analytics(conn):
    """Return portfolio analytics: positions by asset_type, totals, leverage exposure, P&L breakdown."""
    # Positions grouped by asset_type
    rows = conn.execute("""
        SELECT asset_type,
               COUNT(*) as count,
               SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
               SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count,
               SUM(CASE WHEN status = 'open' THEN entry_price * quantity ELSE 0 END) as open_value,
               SUM(CASE WHEN pnl_usd IS NOT NULL THEN pnl_usd ELSE 0 END) as total_pnl_usd,
               AVG(CASE WHEN pnl_pct IS NOT NULL THEN pnl_pct END) as avg_pnl_pct
        FROM portfolio_positions
        GROUP BY asset_type
    """).fetchall()

    categories = []
    total_value = 0.0
    total_pnl_usd = 0.0

    for r in rows:
        d = dict(r)
        d["open_value"] = round(d["open_value"] or 0, 2)
        d["total_pnl_usd"] = round(d["total_pnl_usd"] or 0, 2)
        d["avg_pnl_pct"] = round(d["avg_pnl_pct"] or 0, 2)
        total_value += d["open_value"]
        total_pnl_usd += d["total_pnl_usd"]
        categories.append(d)

    # Leverage exposure: sum of (entry_price * quantity * leverage) for open leveraged positions
    lev_row = conn.execute("""
        SELECT COALESCE(SUM(entry_price * quantity * leverage), 0) as leveraged_value
        FROM portfolio_positions
        WHERE status = 'open' AND leverage > 1
    """).fetchone()
    leverage_exposure = round(dict(lev_row)["leveraged_value"], 2)

    # Overall counts
    totals_row = conn.execute("""
        SELECT COUNT(*) as total,
               SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_total,
               SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_total,
               SUM(CASE WHEN pnl_pct IS NOT NULL AND pnl_pct > 0 THEN 1 ELSE 0 END) as winners,
               SUM(CASE WHEN pnl_pct IS NOT NULL AND pnl_pct < 0 THEN 1 ELSE 0 END) as losers,
               SUM(CASE WHEN pnl_pct IS NOT NULL AND pnl_pct = 0 THEN 1 ELSE 0 END) as breakeven
        FROM portfolio_positions
    """).fetchone()

    totals = dict(totals_row)
    decided = (totals["winners"] or 0) + (totals["losers"] or 0)
    win_rate = round(((totals["winners"] or 0) / decided) * 100, 1) if decided > 0 else 0

    print(json.dumps({
        "categories": categories,
        "total_value": round(total_value, 2),
        "leverage_exposure": leverage_exposure,
        "total_pnl_usd": round(total_pnl_usd, 2),
        "totals": {
            "total": totals["total"] or 0,
            "open": totals["open_total"] or 0,
            "closed": totals["closed_total"] or 0,
            "winners": totals["winners"] or 0,
            "losers": totals["losers"] or 0,
            "breakeven": totals["breakeven"] or 0,
            "win_rate": win_rate,
        },
    }))


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "list"
    db_path = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    ensure_table(conn)

    try:
        if action == "list":
            cmd_list(conn)
        elif action == "add":
            cmd_add(conn, sys.argv[2:])
        elif action == "update":
            cmd_update(conn, sys.argv[2:])
        elif action == "close":
            cmd_close(conn, sys.argv[2:])
        elif action == "remove":
            cmd_remove(conn, sys.argv[2:])
        elif action == "analytics":
            cmd_analytics(conn)
        else:
            print(json.dumps({"error": f"Unknown action: {action}"}))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
