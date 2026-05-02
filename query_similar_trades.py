#!/usr/bin/env python3
"""Find trades similar to a given base trade.

Args:
  argv[1] = trade_source ('auto_trades')
  argv[2] = trade_id

Strategy:
  1. Try ChromaDB collection (CHROMA_TRADE_COLLECTION) — graceful miss
     since the deployed instance has no `trade_embeddings` collection.
  2. Fall through to feature-vector cosine similarity over the closed
     live auto_trades universe.

confidence + regime are read directly from auto_trades (no auto_signal_log
join — table does not exist on this instance).
"""
from __future__ import annotations

import json
import math
import sqlite3
import sys
from typing import Any, Dict, List, Optional, Tuple

DB = "/home/trevor/trevor/trevor.db"
TOP_K = 8

try:
    import chromadb  # type: ignore
    CHROMA_AVAILABLE = True
except Exception:
    CHROMA_AVAILABLE = False

CHROMA_TRADE_COLLECTION = "trade_embeddings"


def fetch_trade(conn: sqlite3.Connection, trade_id: int) -> Optional[Dict[str, Any]]:
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        """
        SELECT id, ticker, direction, entry_price, leverage, notional_usd,
               pnl_pct, pnl_usd, opened_at, closed_at, exit_reason,
               peak_pnl_pct, status, trade_mode, confidence, adjusted_confidence,
               regime_at_entry
        FROM auto_trades
        WHERE id = ?
        """,
        (trade_id,),
    ).fetchone()
    return dict(row) if row else None


def build_feature_vector(t: Dict[str, Any], all_tickers: List[str], all_regimes: List[str]) -> List[float]:
    conf_raw = t.get("adjusted_confidence")
    if conf_raw is None:
        conf_raw = t.get("confidence") or 0.0
    conf = float(conf_raw) / 100.0
    direction = 1.0 if str(t.get("direction", "")).upper() == "LONG" else -1.0
    leverage = float(t.get("leverage") or 1.0) / 10.0
    ticker_oh = [1.0 if str(t.get("ticker", "")).upper() == tk else 0.0 for tk in all_tickers]
    regime_oh = [1.0 if str(t.get("regime_at_entry") or "") == r else 0.0 for r in all_regimes]
    return [conf, direction, leverage] + ticker_oh + regime_oh


def cosine(a: List[float], b: List[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def feature_vector_similar(conn: sqlite3.Connection, base: Dict[str, Any]) -> List[Dict[str, Any]]:
    conn.row_factory = sqlite3.Row
    candidates = conn.execute(
        """
        SELECT id, ticker, direction, entry_price, leverage,
               pnl_pct, pnl_usd, closed_at, exit_reason,
               confidence, adjusted_confidence, regime_at_entry
        FROM auto_trades
        WHERE status='closed' AND id <> ? AND trade_mode='live'
        """,
        (base["id"],),
    ).fetchall()
    rows = [dict(r) for r in candidates]
    if not rows:
        return []

    pool = rows + [base]
    all_tickers = sorted({r["ticker"] for r in pool if r.get("ticker")})
    all_regimes = sorted({(r.get("regime_at_entry") or "") for r in pool})

    base_v = build_feature_vector(base, all_tickers, all_regimes)
    scored: List[Tuple[float, Dict[str, Any]]] = []
    for r in rows:
        v = build_feature_vector(r, all_tickers, all_regimes)
        score = cosine(base_v, v)
        scored.append((score, r))
    scored.sort(key=lambda x: x[0], reverse=True)
    out: List[Dict[str, Any]] = []
    for score, r in scored[:TOP_K]:
        out.append({
            "id": r["id"],
            "ticker": r["ticker"],
            "direction": r["direction"],
            "pnl_pct": float(r["pnl_pct"] or 0),
            "pnl_usd": float(r["pnl_usd"] or 0),
            "closed_at": r["closed_at"],
            "exit_reason": r["exit_reason"],
            "similarity_score": round(score, 4),
            "distance": round(1.0 - score, 4),
        })
    return out


def chroma_similar(base: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    if not CHROMA_AVAILABLE:
        return None
    try:
        client = chromadb.PersistentClient(path="/home/trevor/trevor/vectordb")
        coll = client.get_collection(CHROMA_TRADE_COLLECTION)
    except Exception:
        return None
    try:
        base_uri = f"auto:{base['id']}"
        got = coll.get(ids=[base_uri], include=["embeddings", "metadatas"])
        embs = got.get("embeddings") if got else None
        if not embs or len(embs) == 0 or embs[0] is None:
            return None
        result = coll.query(
            query_embeddings=embs,
            n_results=TOP_K + 1,
            include=["distances", "metadatas"],
        )
    except Exception:
        return None

    if not result or not result.get("ids") or not result["ids"][0]:
        return None
    out: List[Dict[str, Any]] = []
    metas_outer = result.get("metadatas") or [[]]
    dists_outer = result.get("distances") or [[]]
    metas = metas_outer[0] if metas_outer else []
    dists = dists_outer[0] if dists_outer else []
    for idx, doc_id in enumerate(result["ids"][0]):
        if doc_id == base_uri:
            continue
        meta = metas[idx] if idx < len(metas) else {}
        dist = dists[idx] if idx < len(dists) else 0.0
        out.append({
            "id": meta.get("trade_id") or doc_id,
            "ticker": meta.get("ticker"),
            "direction": meta.get("direction"),
            "pnl_pct": float(meta.get("pnl_pct") or 0),
            "pnl_usd": float(meta.get("pnl_usd") or 0),
            "closed_at": meta.get("closed_at"),
            "exit_reason": meta.get("exit_reason"),
            "similarity_score": round(1.0 - float(dist), 4),
            "distance": round(float(dist), 4),
        })
        if len(out) >= TOP_K:
            break
    return out


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: query_similar_trades.py auto_trades <id>"}), file=sys.stderr)
        sys.exit(2)
    source = sys.argv[1]
    try:
        trade_id = int(sys.argv[2])
    except ValueError:
        print(json.dumps({"error": "trade_id must be int"}), file=sys.stderr)
        sys.exit(2)
    if source != "auto_trades":
        print(json.dumps({"error": f"unsupported source '{source}'"}), file=sys.stderr)
        sys.exit(2)

    try:
        with sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10) as conn:
            base = fetch_trade(conn, trade_id)
            if not base:
                # Soft error on stdout so the route delivers a clean JSON
                # to the UI instead of a wrapped subprocess exception.
                print(json.dumps({
                    "error": f"trade {trade_id} not found",
                    "base": None,
                    "similar": [],
                    "method": "feature_vector",
                    "top_k": TOP_K,
                }))
                return
            similar = chroma_similar(base)
            method = "chromadb"
            if not similar:
                similar = feature_vector_similar(conn, base)
                method = "feature_vector"
        print(json.dumps({
            "base": {
                "id": base["id"], "ticker": base["ticker"], "direction": base["direction"],
                "pnl_pct": float(base.get("pnl_pct") or 0),
                "pnl_usd": float(base.get("pnl_usd") or 0),
                "closed_at": base.get("closed_at"),
                "confidence_at_entry": (
                    float(base["adjusted_confidence"]) if base.get("adjusted_confidence") is not None
                    else (float(base["confidence"]) if base.get("confidence") is not None else None)
                ),
                "regime_at_entry": base.get("regime_at_entry"),
                "leverage": float(base.get("leverage") or 1),
            },
            "similar": similar,
            "method": method,
            "top_k": TOP_K,
        }))
    except Exception as exc:
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
