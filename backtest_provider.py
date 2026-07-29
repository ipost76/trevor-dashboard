#!/usr/bin/env python3
"""RP-C3 — the ``backtest_fn`` provider (working name RF-BACKTEST).

Closes the learning loop's missing provider: ``trainer_loop.run_trainer_loop``
carries a seam ``backtest_fn: Optional[Callable[[dict, int], dict]]`` that is
``None`` in production, so the compass pre-score is skipped entirely.  This
module supplies that callable, built to ``docs/design/BACKTEST_FN_SPEC.md``.

🚨 SHIPS UNWIRED.  Nothing in this repo passes this function to the loop.  The
production entrypoint is ``trainer_loop.main() -> run_trainer_loop(level=level)``
with NO ``backtest_fn`` argument, so the seam keeps its ``None`` default and the
loop's behaviour is byte-identical to before this module existed.  Arming it is
Ghost's call, and the wiring itself is RP-C2's file (``trainer_loop.py``).


THE DESIGN — why this is a counterfactual AND validatable
=========================================================
The spec's §4 is emphatic that ``backtest_fn`` cannot be a query over historical
trades: the trainer proposes a config arm and asks "how would the book have
performed UNDER THIS CONFIG?", and the real trades ran under the live config.
But the acceptance criterion for this build is "replay real closed trades and
reproduce their actual realized P&L" — and a pure counterfactual cannot be
validated against a book that ran under a different config.

Resolution (Ghost-approved, RP-C3): this is a **counterfactual re-simulation of
the real book under the proposed arm**, where the **IDENTITY CASE (arm = the
live config) must reproduce history exactly**.  The identity property IS the
validation.  See ``replay_identity()`` and the tolerance stated in the wave
record.

That works because 6 of the 9 sampleable axes RESIZE or FILTER the book rather
than re-time it — they need no candles:

    SUPPORTED (candle-free)            UNSUPPORTED (needs candles + signal/exit engine)
    ----------------------------       ------------------------------------------------
    size.risk_fraction                 timeframe.bars
    leverage.lmax_fraction             exit.tail_cap_lmax_fraction / ratchet_schedule
    portfolio.deployment_ceiling       hedge.enabled
    timing_context.regime_as_posture
    direction.mode
    tickers.universe_subset

The spec's own worked example (``deployment_ceiling`` 0.55 vs the 0.45 default)
sits in the SUPPORTED family, so the motivating case is exactly what this does
correctly.

🚨 An arm touching an UNSUPPORTED axis returns an explicit, INSPECTABLE
``unsupported_axis`` result that carries NO usable ``equity_curve`` — so the
compass's fail-safe rejects it (``_assess_dd`` -> None -> gate (a) REJECT).
NEVER a silent zero and NEVER a fabricated flat curve: a silent zero reads as
"no edge", which is indistinguishable from a real answer and is precisely how
this project has manufactured false confidence before.


DATA LAWS OBSERVED (each one measured, not assumed — RP-C3 Phase 0)
==================================================================
* **Position size is era-free.**  ``notional_usd`` IS the posted MARGIN (not the
  position notional), and ``leverage`` is 100% populated, so
  ``notional = notional_usd * leverage``.  🚨 ``original_notional_usd`` is NEVER
  read: it means three different things by era (margin in Apr / NULL in May /
  margin x leverage in Jun+) and is NULL on 994 of 1754 closed rows (56.7%).
  Measured coverage: ``notional_usd`` 1754/1754, ``leverage`` 1754/1754.

* **🚨 The clock offset is ERA-SPLIT, not universal.**  ``opened_at``/``closed_at``
  are naive Eastern ONLY from 2026-06-24; before that they are already real UTC.
  Measured: era-1 (n=999) offset avg 0.0441 h / min 0.0; era-2 (n=755) offset
  avg 4.0003 h / min 4.0000 / max 4.0181.  Applying a blanket 4 h offset would
  corrupt 999 of 1754 trades (57%).  ``created_at`` is real UTC in every era.
  The seam is safe to SPLIT because the book was flat across it: era-1's last
  close 09:15:19Z, era-2's first open 16:27:09Z (7 h 11 m 50 s flat).

* **Cost is the invariant 8.098 bps bar.**  Mirrored, never imported (importing
  ``auto_trader`` trips the WSL barrier) — the same pattern ``compass_metrics``
  uses.  The config surface marks ``cost`` as "Cost bar (invariant)", described
  but never sampled, so no arm may move it.

* **Slippage is NOT a cost centre.**  It is a net benefit on this system; the
  "slippage = 82% of loss" claim was overturned.  No slippage debit exists here.

* **Intraday-worst comes from recorded excursions, not candles.**
  ``mae_pnl_pct`` (Maximum Adverse Excursion, signed <= 0) is 100% populated on
  the closed book, so ``net_pnl_series`` carries genuine intraday-worst P&L
  without needing a candle feed.  This matters: the spec §3b calibration says a
  close-only series makes the CVaR gate blind to the exact one-day-wick event it
  exists to catch.

* **DISTINCT per trade** on every count and dollar figure; raw row-sum is banned.

* **Correlation is deliberately NOT emitted.**  The compass consumes an optional
  6th key ``correlation`` (``_K_CORR``, RF3T2-B3) that the spec's "five required
  keys" predates.  RP-C4 landed a correlation instrument this same wave that
  computes n_eff / rho-bar hourly and persists it; emitting a SECOND correlation
  number computed here by a different method would give two numbers that
  disagree with nobody able to say which is right.  Leaving it absent makes the
  compass take its documented conservative fallback (n_eff = 1.0, the rho=1
  limit).  A conservative fallback beats two disagreeing numbers.  Follow-up:
  emit C4's value once it has forward data.

Stdlib-only.  Nothing runs on import.
"""

from __future__ import annotations

import base64
import json
import math
import os
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

__all__ = [
    "FEE_BPS_ROUNDTRIP",
    "DEPLOYMENT_CEILING_NULL",
    "CAPITAL_BASIS_USD",
    "SUPPORTED_AXES",
    "UNSUPPORTED_AXES",
    "Trade",
    "AccessRecorder",
    "GuardedBook",
    "LookAheadError",
    "load_book",
    "resolve_arm",
    "simulate",
    "make_backtest_fn",
    "backtest_fn",
    "replay_identity",
]

# ---------------------------------------------------------------------------
# Constants — MIRRORED from the bot/compass, never imported (WSL barrier).
# ---------------------------------------------------------------------------

#: Round-trip cost bar in basis points.  INVARIANT — the config surface marks
#: `cost` as "described but never sampled", and `compass_metrics` hardcodes the
#: same 8.098.  Mirrored here (not imported) exactly as `compass_metrics` does.
#: ⚠️ MEASURED DIVERGENCE (RP-C3): the *realized* round-trip cost on the live
#: book averages 8.9909 bps (n=1326 non-partial closed trades, min -0.0180,
#: max 13.0106) — about 11% ABOVE this modelling bar.  The bar is NOT changed
#: here (it is the objective function's constant); the replay reports error at
#: both rates so the gap stays legible instead of buried.
FEE_BPS_ROUNDTRIP: float = 8.098

#: Mirror of `trainer_capital.DEPLOYMENT_CEILING_NULL` — Ghost's conservative
#: default deployment posture.  Mirrored, not imported.
DEPLOYMENT_CEILING_NULL: float = 0.45

#: The capital basis the equity curve is anchored to, in USD.  This is the
#: campaign's established TRUE lifetime net deposits (all capital in minus all
#: capital out, ever) — the same figure the Hub uses as its realized-% base.
#: ⚠️ NOT an arbitrary constant: the account's own `equity_snapshots` only begin
#: 2026-05-29, five weeks after the book opens, so a snapshot anchor would be
#: unavailable for the first ~5 weeks of the replay.  Measured account equity
#: over the window ranged $20.65 - $104.40, so this basis is the generous end of
#: the real range — it cannot flatter a drawdown result.
CAPITAL_BASIS_USD: float = 122.18

#: 🚨 The clock seam.  Rows stamped at/after this instant carry naive EASTERN
#: `opened_at`/`closed_at`; rows before it are already real UTC.  The book was
#: flat across the seam, so splitting here cannot bisect an open position.
_ET_ERA_START = datetime(2026, 6, 24, 12, 0, 0)
_ET_OFFSET = timedelta(hours=4)

#: Axes this provider can simulate without candles (resize / filter the book).
SUPPORTED_AXES = frozenset({
    "size", "leverage", "portfolio", "timing_context", "direction", "tickers",
})

#: Axes that change WHICH trades happen or WHEN they exit — these need a candle
#: feed plus the signal/exit engine, which is out of scope for this build.
UNSUPPORTED_AXES = frozenset({"timeframe", "exit", "hedge"})

#: Minimum points the compass needs for an assessable drawdown curve
#: (`compass_metrics._DD_MIN_N`).  Mirrored so we can refuse to emit a curve we
#: know is unassessable rather than emit one that silently rejects.
_DD_MIN_N = 2

_DEFAULT_DB = "/home/trevor/trevor/trevor.db"
_SSH_TIMEOUT_SEC = 90


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class LookAheadError(RuntimeError):
    """Raised by :class:`GuardedBook` when a read reaches past the cutoff.

    This is the positive-control tripwire for Phase 3.  It exists so that a
    look-ahead defect is a LOUD failure, never a quietly better backtest.
    """


class BookLoadError(RuntimeError):
    """The trade book could not be loaded.  Never swallowed into an empty book."""


# ---------------------------------------------------------------------------
# Clock — era-split normalisation
# ---------------------------------------------------------------------------

def _parse_naive(ts: Any) -> Optional[datetime]:
    """Parse a SQLite ``YYYY-MM-DD HH:MM:SS`` stamp to a naive datetime."""
    if not isinstance(ts, str) or not ts.strip():
        return None
    raw = ts.strip().replace("T", " ")
    if raw.endswith("Z"):
        raw = raw[:-1]
    raw = raw.split("+")[0].split(".")[0].strip()
    try:
        return datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        try:
            return datetime.strptime(raw, "%Y-%m-%d")
        except ValueError:
            return None


def to_utc(ts: Any) -> Optional[datetime]:
    """Normalise an ``opened_at``/``closed_at`` stamp to real UTC.

    🚨 ERA-SPLIT, never a blanket offset.  A stamp before ``_ET_ERA_START`` is
    already UTC and is returned unchanged; a stamp at/after it is naive Eastern
    and gets +4 h.  Measured on the live book: era-1 n=999 offset ~0.0 h,
    era-2 n=755 offset exactly 4.0 h.  A universal +4 h would corrupt 57% of
    the replay set.
    """
    naive = _parse_naive(ts)
    if naive is None:
        return None
    if naive < _ET_ERA_START:
        return naive.replace(tzinfo=timezone.utc)
    return (naive + _ET_OFFSET).replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# The normalised trade record
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Trade:
    """One closed trade, normalised era-free and clock-corrected.

    ``notional`` is the POSITION notional, reconstructed as
    ``margin_usd * leverage``.  🚨 ``original_notional_usd`` is never used.
    """

    trade_id: int
    ticker: str
    direction: str            # "LONG" | "SHORT"
    entry_price: float
    exit_price: float
    leverage: float
    margin_usd: float         # `notional_usd` — the POSTED MARGIN
    opened_at: datetime       # real UTC
    closed_at: datetime       # real UTC
    recorded_pnl: Optional[float]          # `pnl_usd`
    recorded_partial: float                # `partial_pnl_realized`, 0.0 if null
    mae_pnl_pct: float                     # signed <= 0, intraday-worst %

    @property
    def notional(self) -> float:
        """Position notional = posted margin x leverage.  Era-free."""
        return self.margin_usd * self.leverage

    @property
    def sign(self) -> float:
        return 1.0 if self.direction.upper() == "LONG" else -1.0

    @property
    def price_move_frac(self) -> float:
        if self.entry_price <= 0.0:
            return 0.0
        return (self.exit_price - self.entry_price) / self.entry_price

    @property
    def canonical_pnl(self) -> Optional[float]:
        """The canonical realized P&L: ``pnl_usd + partial_pnl_realized``."""
        if self.recorded_pnl is None:
            return None
        return self.recorded_pnl + self.recorded_partial

    def gross_at(self, notional: float) -> float:
        """Gross (pre-cost) P&L if the position had this notional."""
        return self.price_move_frac * self.sign * notional

    def worst_gross_at(self, notional: float) -> float:
        """🚨 INTRADAY-WORST gross P&L — the adverse excursion, not the close.

        Uses the recorded ``mae_pnl_pct`` (signed <= 0).  The spec §3b is
        explicit that a close-only series makes the CVaR gate blind to the
        one-day wick it exists to catch, so this is the value that feeds
        ``net_pnl_series``.  The worst point is never better than the close.
        """
        adverse = (self.mae_pnl_pct / 100.0) * notional
        return min(adverse, self.gross_at(notional))


def _finite(x: Any) -> Optional[float]:
    """Coerce to a finite float or None.  Never returns NaN/inf.

    🚨 A non-finite value that sails through reads as a real number downstream
    (`cfg_float` has no finiteness check — the systemic enabler this campaign
    keeps finding).  Everything numeric entering this module goes through here.
    """
    if x is None or isinstance(x, bool):
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return v


# ---------------------------------------------------------------------------
# Book loading — read-only over the ssh pipe, VM live db (authoritative)
# ---------------------------------------------------------------------------

_BOOK_SQL = """
SELECT id, ticker, direction, entry_price, exit_price, leverage,
       notional_usd, opened_at, closed_at, pnl_usd,
       COALESCE(partial_pnl_realized, 0.0), COALESCE(mae_pnl_pct, 0.0)
FROM auto_trades
WHERE status = 'closed'
ORDER BY id
"""

_REMOTE_PROGRAM = r'''
import json, sqlite3, sys
db = {db!r}
sql = {sql!r}
con = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
rows = [list(r) for r in con.execute(sql)]
con.close()
sys.stdout.write(json.dumps(rows))
'''


def _load_rows_via_ssh(db_path: str, host: str = "vm") -> List[list]:
    """Fetch the closed-trade book from the VM live db, READ-ONLY.

    Uses the house pattern: a stdlib-only remote program, base64-embedded so no
    value ever touches the remote shell, run through ``sudo -u trevor`` with the
    db opened ``mode=ro``.  🚨 The replica is never read — the compass is a
    DECISION path and `lib/trainer_db.py` hard-refuses the 0444 replica by
    design (the matched-data guarantee).
    """
    program = _REMOTE_PROGRAM.format(db=db_path, sql=_BOOK_SQL)
    blob = base64.b64encode(program.encode("utf-8")).decode("ascii")
    remote = (
        "echo %s | base64 -d | sudo -n -u trevor /usr/bin/python3 -" % blob
    )
    argv = [
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, remote,
    ]
    env = {**os.environ, "HOME": os.environ.get("HOME", "/home/ghost")}
    try:
        proc = subprocess.run(
            argv, capture_output=True, text=True,
            timeout=_SSH_TIMEOUT_SEC, env=env,
        )
    except subprocess.TimeoutExpired as exc:
        raise BookLoadError("book load timed out after %ss" % _SSH_TIMEOUT_SEC) from exc
    except OSError as exc:
        raise BookLoadError("book load could not spawn ssh: %s" % exc) from exc
    if proc.returncode != 0:
        raise BookLoadError(
            "book load failed rc=%s stderr=%s"
            % (proc.returncode, (proc.stderr or "").strip()[:400])
        )
    out = (proc.stdout or "").strip()
    if not out:
        raise BookLoadError("book load returned empty output")
    try:
        rows = json.loads(out)
    except json.JSONDecodeError as exc:
        raise BookLoadError("book load returned malformed JSON: %s" % exc) from exc
    if not isinstance(rows, list):
        raise BookLoadError("book load returned a non-list payload")
    return rows


def rows_to_trades(rows: Sequence[Sequence[Any]]) -> Tuple[List[Trade], Dict[str, int]]:
    """Normalise raw rows into :class:`Trade` records.

    Returns ``(trades, skipped)`` where ``skipped`` counts each reason a row was
    dropped.  🚨 A row that cannot be normalised is COUNTED and REPORTED, never
    coerced to a zero-P&L trade (that would smuggle a fake trade into the book).
    """
    trades: List[Trade] = []
    skipped: Dict[str, int] = {}

    def drop(reason: str) -> None:
        skipped[reason] = skipped.get(reason, 0) + 1

    seen_ids: set = set()
    for r in rows:
        if not isinstance(r, (list, tuple)) or len(r) < 12:
            drop("malformed_row")
            continue
        (tid, ticker, direction, entry, exit_, lev,
         margin, opened, closed, pnl, partial, mae) = r[:12]

        try:
            tid_i = int(tid)
        except (TypeError, ValueError):
            drop("bad_id")
            continue
        if tid_i in seen_ids:          # DISTINCT per trade, structurally
            drop("duplicate_id")
            continue

        entry_f = _finite(entry)
        exit_f = _finite(exit_)
        lev_f = _finite(lev)
        margin_f = _finite(margin)
        if entry_f is None or entry_f <= 0.0:
            drop("bad_entry_price")
            continue
        if exit_f is None or exit_f <= 0.0:
            drop("bad_exit_price")
            continue
        if lev_f is None or lev_f <= 0.0:
            drop("bad_leverage")
            continue
        if margin_f is None or margin_f <= 0.0:
            drop("bad_margin")
            continue

        opened_dt = to_utc(opened)
        closed_dt = to_utc(closed)
        if opened_dt is None or closed_dt is None:
            drop("bad_timestamp")
            continue

        d = str(direction or "").upper()
        if d not in ("LONG", "SHORT"):
            drop("bad_direction")
            continue

        mae_f = _finite(mae)
        mae_f = 0.0 if mae_f is None else min(0.0, mae_f)   # MAE is <= 0
        partial_f = _finite(partial) or 0.0
        pnl_f = _finite(pnl)          # may legitimately be None (2 live rows)

        seen_ids.add(tid_i)
        trades.append(Trade(
            trade_id=tid_i,
            ticker=str(ticker or "").strip() or "UNKNOWN",
            direction=d,
            entry_price=entry_f,
            exit_price=exit_f,
            leverage=lev_f,
            margin_usd=margin_f,
            opened_at=opened_dt,
            closed_at=closed_dt,
            recorded_pnl=pnl_f,
            recorded_partial=partial_f,
            mae_pnl_pct=mae_f,
        ))
    return trades, skipped


def load_book(db_path: str = _DEFAULT_DB, host: str = "vm",
              rows: Optional[Sequence[Sequence[Any]]] = None
              ) -> Tuple[List[Trade], Dict[str, int]]:
    """Load + normalise the closed-trade book.

    ``rows`` may be supplied directly (tests / cached fixtures); otherwise the
    book is fetched read-only from the VM live db over the ssh pipe.
    """
    if rows is None:
        rows = _load_rows_via_ssh(db_path, host=host)
    return rows_to_trades(rows)


# ---------------------------------------------------------------------------
# Phase 3 — the look-ahead guard
# ---------------------------------------------------------------------------

class AccessRecorder:
    """Records the maximum timestamp any data read has touched.

    🚨 This instruments the ACCESS, it does not inspect the code.  "I was
    careful" is not evidence; a recorded high-water mark is.
    """

    def __init__(self) -> None:
        self.max_ts: Optional[datetime] = None
        self.reads: int = 0

    def note(self, ts: Optional[datetime]) -> None:
        self.reads += 1
        if ts is None:
            return
        if self.max_ts is None or ts > self.max_ts:
            self.max_ts = ts

    def reset(self) -> None:
        self.max_ts = None
        self.reads = 0


class GuardedBook:
    """A trade book that refuses to hand out anything past a cutoff.

    Every read funnels through here, so a look-ahead is caught at the access
    layer rather than argued about at the code layer.  ``strict=True`` raises
    :class:`LookAheadError` the moment a read reaches past ``cutoff``.
    """

    def __init__(self, trades: Sequence[Trade], recorder: Optional[AccessRecorder] = None,
                 strict: bool = True) -> None:
        self._trades = list(trades)
        self.recorder = recorder if recorder is not None else AccessRecorder()
        self.strict = strict

    def __len__(self) -> int:
        return len(self._trades)

    def visible_at(self, cutoff: Optional[datetime]) -> List[Trade]:
        """Trades whose outcome is KNOWN at ``cutoff`` (closed at or before it).

        This is the only sanctioned accessor for simulation.  A trade that has
        not closed by ``cutoff`` has an outcome the simulator cannot know.
        """
        out: List[Trade] = []
        for t in self._trades:
            if cutoff is not None and t.closed_at > cutoff:
                continue
            self.recorder.note(t.closed_at)
            out.append(t)
        if cutoff is not None and self.recorder.max_ts is not None:
            if self.recorder.max_ts > cutoff and self.strict:
                raise LookAheadError(
                    "read reached %s, past cutoff %s"
                    % (self.recorder.max_ts.isoformat(), cutoff.isoformat())
                )
        return out

    def peek_all(self, cutoff: Optional[datetime] = None) -> List[Trade]:
        """🚨 THE LEAK.  Returns every trade regardless of the cutoff.

        Present ONLY so the Phase-3 positive control has a real defect to catch.
        Production code must never call this — the guard exists to make that
        enforceable rather than aspirational.
        """
        for t in self._trades:
            self.recorder.note(t.closed_at)
        if cutoff is not None and self.recorder.max_ts is not None:
            if self.recorder.max_ts > cutoff and self.strict:
                raise LookAheadError(
                    "read reached %s, past cutoff %s"
                    % (self.recorder.max_ts.isoformat(), cutoff.isoformat())
                )
        return list(self._trades)


# ---------------------------------------------------------------------------
# Arm resolution
# ---------------------------------------------------------------------------

@dataclass
class ResolvedArm:
    """The subset of an arm this provider can act on, with the rest refused."""

    risk_fraction: float = 1.0
    lmax_fraction: float = 1.0
    deployment_ceiling: float = DEPLOYMENT_CEILING_NULL
    regime_as_posture: float = 1.0
    direction_mode: str = "BOTH"
    universe_subset: Optional[frozenset] = None
    unsupported: Tuple[str, ...] = ()
    invalid: Tuple[str, ...] = ()

    @property
    def usable(self) -> bool:
        return not self.unsupported and not self.invalid

    @property
    def effective_ceiling(self) -> float:
        """``regime_as_posture`` applies TO ``deployment_ceiling`` (per schema)."""
        return self.deployment_ceiling * self.regime_as_posture


def _unit_interval(v: Any, name: str, invalid: List[str],
                   allow_zero: bool = False) -> Optional[float]:
    f = _finite(v)
    if f is None:
        invalid.append("%s:non_finite" % name)
        return None
    lo_ok = (f >= 0.0) if allow_zero else (f > 0.0)
    if not lo_ok or f > 1.0:
        invalid.append("%s:out_of_domain" % name)
        return None
    return f


def resolve_arm(arm: Any) -> ResolvedArm:
    """Map a proposed arm onto the supported axes.

    An arm is a flat ``{axis_or_param: value}`` dict.  Both the axis-key form
    (``{"size": 0.5}``) and the parameter-name form (``{"risk_fraction": 0.5}``)
    are accepted, since the trainer's surface names both.

    🚨 Any key naming an UNSUPPORTED axis is recorded, and the caller must
    REFUSE the arm — never silently ignore it and return a number for a
    different config than the one asked about.
    """
    out = ResolvedArm()
    if not isinstance(arm, dict):
        out.invalid = ("arm:not_a_dict",)
        return out

    unsupported: List[str] = []
    invalid: List[str] = []

    for key in arm:
        k = str(key).lower()
        for axis in UNSUPPORTED_AXES:
            if k == axis or k.startswith(axis + "."):
                unsupported.append(axis)
    # parameter-name spellings of the unsupported axes
    _UNSUPPORTED_PARAMS = {
        "bars": "timeframe",
        "tail_cap_lmax_fraction": "exit",
        "ratchet_schedule": "exit",
        "enabled": "hedge",
    }
    for pname, axis in _UNSUPPORTED_PARAMS.items():
        if pname in arm:
            unsupported.append(axis)

    def pick(*names: str) -> Any:
        for n in names:
            if n in arm:
                return arm[n]
        return None

    v = pick("size", "risk_fraction", "size.risk_fraction")
    if v is not None:
        f = _unit_interval(v, "size.risk_fraction", invalid)
        if f is not None:
            out.risk_fraction = f

    v = pick("leverage", "lmax_fraction", "leverage.lmax_fraction")
    if v is not None:
        f = _unit_interval(v, "leverage.lmax_fraction", invalid)
        if f is not None:
            out.lmax_fraction = f

    v = pick("deployment_ceiling", "portfolio", "portfolio.deployment_ceiling")
    if v is not None:
        f = _unit_interval(v, "portfolio.deployment_ceiling", invalid)
        if f is not None:
            out.deployment_ceiling = f

    v = pick("regime_as_posture", "timing_context", "timing_context.regime_as_posture")
    if v is not None:
        f = _unit_interval(v, "timing_context.regime_as_posture", invalid)
        if f is not None:
            out.regime_as_posture = f

    v = pick("direction", "mode", "direction.mode")
    if v is not None:
        m = str(v).upper()
        if m not in ("BOTH", "LONG", "SHORT"):
            invalid.append("direction.mode:out_of_domain")
        else:
            out.direction_mode = m

    v = pick("tickers", "universe_subset", "tickers.universe_subset")
    if v is not None:
        if isinstance(v, (list, tuple, set, frozenset)):
            subset = frozenset(str(x).strip() for x in v if str(x).strip())
            if not subset:
                invalid.append("tickers.universe_subset:empty")
            else:
                out.universe_subset = subset
        else:
            invalid.append("tickers.universe_subset:not_a_sequence")

    out.unsupported = tuple(sorted(set(unsupported)))
    out.invalid = tuple(sorted(set(invalid)))
    return out


# ---------------------------------------------------------------------------
# Simulation
# ---------------------------------------------------------------------------

@dataclass
class SimTrade:
    """A trade as re-simulated under the arm."""
    trade: Trade
    notional: float
    gross: float
    worst_gross: float
    cost: float

    @property
    def net(self) -> float:
        return self.gross - self.cost

    @property
    def worst_net(self) -> float:
        return self.worst_gross - self.cost


@dataclass
class SimResult:
    sim_trades: List[SimTrade] = field(default_factory=list)
    filtered_out: int = 0
    total_net: float = 0.0
    total_gross: float = 0.0
    total_cost: float = 0.0


def round_trip_cost(notional: float, fee_bps: float = FEE_BPS_ROUNDTRIP) -> float:
    """The standardised round-trip cost on a position notional.

    Matches `compass_metrics._standardized_cost`: ``notional * bps / 1e4``.
    Slippage is deliberately absent — it is a net benefit on this system, not a
    cost centre.
    """
    n = _finite(notional)
    if n is None or n <= 0.0:
        return 0.0
    return n * (fee_bps / 1e4)


def simulate(book: Sequence[Trade], resolved: ResolvedArm, *,
             fee_bps: float = FEE_BPS_ROUNDTRIP) -> SimResult:
    """Re-simulate the book under the resolved arm.

    The supported axes act as a RESIZE (size / leverage / ceiling / posture) or
    a FILTER (direction / tickers).  Entry and exit prices are historical fact
    and are never moved — that is exactly why the identity case reproduces
    history and why the re-timing axes are refused rather than approximated.
    """
    res = SimResult()
    scale = resolved.risk_fraction * resolved.lmax_fraction
    ceiling_ratio = resolved.effective_ceiling / DEPLOYMENT_CEILING_NULL

    for t in book:
        if resolved.universe_subset is not None and t.ticker not in resolved.universe_subset:
            res.filtered_out += 1
            continue
        if resolved.direction_mode != "BOTH" and t.direction != resolved.direction_mode:
            res.filtered_out += 1
            continue

        notional = t.notional * scale * ceiling_ratio
        gross = t.gross_at(notional)
        worst = t.worst_gross_at(notional)
        cost = round_trip_cost(notional, fee_bps)

        st = SimTrade(trade=t, notional=notional, gross=gross,
                      worst_gross=worst, cost=cost)
        res.sim_trades.append(st)
        res.total_gross += gross
        res.total_cost += cost
        res.total_net += st.net
    return res


# ---------------------------------------------------------------------------
# The five keys
# ---------------------------------------------------------------------------

def _day_key(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d")


def assemble_keys(sim: SimResult, resolved: ResolvedArm,
                  *, starting_equity: float = CAPITAL_BASIS_USD) -> Dict[str, Any]:
    """Build the compass candidate dict from a simulation result.

    Emits exactly the spec's five keys.  ``correlation`` is deliberately NOT
    emitted (see the module docstring) so the compass takes its conservative
    ``n_eff = 1.0`` fallback.

    * ``equity_curve``      — cumulative equity, fractional-drawdown assessable.
    * ``net_pnl_series``    — 🚨 FRACTIONAL (period P&L / deployed basis) AND
                              🚨 INTRADAY-WORST (recorded MAE, not the close).
    * ``daily_returns``     — fractional per-day close-based returns (sortino).
    * ``trades``            — GROSS pnl + the position notional; the compass
                              nets the 8.098 bps bar off it itself.
    * ``deployment_ceiling``— the arm's proposed posture.
    """
    by_day: Dict[str, List[SimTrade]] = {}
    for st in sim.sim_trades:
        by_day.setdefault(_day_key(st.trade.closed_at), []).append(st)
    days = sorted(by_day)

    equity_curve: List[float] = [starting_equity]
    net_pnl_series: List[float] = []
    daily_returns: List[float] = []

    equity = starting_equity
    for d in days:
        day_trades = by_day[d]
        # Deployed basis for the period: the capital actually put to work.
        basis = sum(st.notional for st in day_trades)
        day_net = sum(st.net for st in day_trades)
        day_worst = sum(st.worst_net for st in day_trades)

        if basis > 0.0:
            # 🚨 fractional, and worst-case within the period — not close-only.
            net_pnl_series.append(day_worst / basis)
        if equity > 0.0:
            daily_returns.append(day_net / equity)
        equity += day_net
        equity_curve.append(equity)

    trades_out: List[Dict[str, Any]] = []
    for st in sim.sim_trades:
        # 🚨 GROSS pnl — `per_eff_bet_net` nets the cost bar off it itself.
        # `original_notional_usd` here is OURS: a single-meaning position
        # notional we minted, never the era-ambiguous stored column.
        trades_out.append({
            "ticker": st.trade.ticker,
            "pnl_usd": st.gross,
            "original_notional_usd": st.notional,
        })

    return {
        "equity_curve": equity_curve,
        "net_pnl_series": net_pnl_series,
        "daily_returns": daily_returns,
        "trades": trades_out,
        "deployment_ceiling": resolved.deployment_ceiling,
    }


def _refusal(reason: str, detail: Any) -> Dict[str, Any]:
    """An explicit, inspectable refusal.

    🚨 Carries NO usable ``equity_curve``, so the compass's documented fail-safe
    rejects the arm (`_assess_dd` -> None -> gate (a) REJECT).  It is NEVER a
    flat zero curve: a silent zero reads as "no edge" and is indistinguishable
    from a real answer.
    """
    return {
        "error": reason,
        "detail": detail,
        "usable": False,
        "equity_curve": [],
        "net_pnl_series": [],
        "daily_returns": [],
        "trades": [],
        "deployment_ceiling": DEPLOYMENT_CEILING_NULL,
    }


# ---------------------------------------------------------------------------
# The provider
# ---------------------------------------------------------------------------

def make_backtest_fn(book: Optional[Sequence[Trade]] = None,
                     *, loader: Optional[Callable[[], Sequence[Trade]]] = None,
                     starting_equity: float = CAPITAL_BASIS_USD,
                     fee_bps: float = FEE_BPS_ROUNDTRIP,
                     ) -> Callable[[Dict[str, Any], int], Dict[str, Any]]:
    """Build a ``backtest_fn(arm, level) -> dict`` closure over a cached book.

    The book is loaded once (lazily) and reused, so the loop does not pay an
    ssh round-trip per arm.
    """
    cache: Dict[str, Any] = {"book": list(book) if book is not None else None}

    def _book() -> Sequence[Trade]:
        if cache["book"] is None:
            if loader is not None:
                cache["book"] = list(loader())
            else:
                cache["book"] = load_book()[0]
        return cache["book"]

    def _fn(arm: Dict[str, Any], level: int) -> Dict[str, Any]:
        try:
            lvl = int(level)
        except (TypeError, ValueError):
            return _refusal("invalid_level", repr(level))
        if lvl < 1:
            # The trainer never runs at level 0 — 0 IS the corruption.
            return _refusal("invalid_level", lvl)

        resolved = resolve_arm(arm)
        if resolved.unsupported:
            return _refusal("unsupported_axis", list(resolved.unsupported))
        if resolved.invalid:
            return _refusal("invalid_arm", list(resolved.invalid))

        try:
            trades = _book()
        except BookLoadError as exc:
            return _refusal("book_unavailable", str(exc))

        if not trades:
            return _refusal("empty_book", 0)

        sim = simulate(trades, resolved, fee_bps=fee_bps)
        if not sim.sim_trades:
            # Every trade filtered out by the arm's own direction/ticker choice.
            return _refusal("no_trades_after_filter", resolved.direction_mode)

        out = assemble_keys(sim, resolved, starting_equity=starting_equity)
        if len(out["equity_curve"]) < _DD_MIN_N:
            return _refusal("curve_unassessable", len(out["equity_curve"]))
        out["usable"] = True
        out["level"] = lvl
        return out

    return _fn


def backtest_fn(arm: Dict[str, Any], level: int) -> Dict[str, Any]:
    """The spec's interface: ``backtest_fn(arm: dict, level: int) -> dict``.

    🚨 Module-level convenience ONLY.  Nothing in this repo passes it to
    ``run_trainer_loop`` — the seam keeps its ``None`` default and the loop is
    byte-identical to before this module existed.
    """
    global _DEFAULT_FN
    if _DEFAULT_FN is None:
        _DEFAULT_FN = make_backtest_fn()
    return _DEFAULT_FN(arm, level)


_DEFAULT_FN: Optional[Callable[[Dict[str, Any], int], Dict[str, Any]]] = None


# ---------------------------------------------------------------------------
# Phase 2 — the identity replay (THE acceptance criterion)
# ---------------------------------------------------------------------------

def replay_identity(book: Sequence[Trade], *,
                    fee_bps: float = FEE_BPS_ROUNDTRIP) -> Dict[str, Any]:
    """Replay the real book under the IDENTITY arm and compare to history.

    The identity arm is "the live config": no resize, no filter.  Under it the
    simulator's modelled net P&L must reproduce each trade's canonical realized
    P&L (``pnl_usd + partial_pnl_realized``).

    Returns a report carrying the error DISTRIBUTION — median, tails, and the
    worst trades — split by cohort, because the partial-ladder cohort is where
    the fee under-booking lives and excluding it would flatter the result.
    """
    identity = ResolvedArm()          # all defaults == the live config
    sim = simulate(book, identity, fee_bps=fee_bps)

    rows: List[Dict[str, Any]] = []
    unreplayable = 0
    for st in sim.sim_trades:
        canonical = st.trade.canonical_pnl
        if canonical is None:
            unreplayable += 1
            continue
        rows.append({
            "id": st.trade.trade_id,
            "ticker": st.trade.ticker,
            "modelled": st.net,
            "canonical": canonical,
            "error": st.net - canonical,
            "abs_error": abs(st.net - canonical),
            "notional": st.notional,
            "has_partial": st.trade.recorded_partial != 0.0,
        })

    def _stats(subset: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not subset:
            return {"n": 0}
        errs = sorted(r["abs_error"] for r in subset)
        n = len(errs)

        def q(p: float) -> float:
            if n == 1:
                return errs[0]
            idx = min(n - 1, max(0, int(round(p * (n - 1)))))
            return errs[idx]

        modelled = sum(r["modelled"] for r in subset)
        canonical = sum(r["canonical"] for r in subset)
        return {
            "n": n,
            "median_abs_error": q(0.50),
            "p90_abs_error": q(0.90),
            "p99_abs_error": q(0.99),
            "max_abs_error": errs[-1],
            "mean_error": sum(r["error"] for r in subset) / n,
            "sum_modelled": modelled,
            "sum_canonical": canonical,
            "aggregate_error": modelled - canonical,
            "aggregate_rel_error": (
                abs(modelled - canonical) / abs(canonical) if canonical else None
            ),
        }

    non_partial = [r for r in rows if not r["has_partial"]]
    partial = [r for r in rows if r["has_partial"]]
    worst = sorted(rows, key=lambda r: -r["abs_error"])[:10]

    return {
        "fee_bps": fee_bps,
        "n_replayed": len(rows),
        "n_unreplayable": unreplayable,
        "n_filtered": sim.filtered_out,
        "all": _stats(rows),
        "non_partial": _stats(non_partial),
        "partial": _stats(partial),
        "worst_trades": worst,
    }


# ---------------------------------------------------------------------------
# CLI — read-only, for the replay report.  Nothing runs on import.
# ---------------------------------------------------------------------------

def _main(argv: Sequence[str]) -> int:
    cache_path = None
    for i, a in enumerate(argv):
        if a == "--cache" and i + 1 < len(argv):
            cache_path = argv[i + 1]

    # 🚨 The cache holds RAW rows, never normalised ones.  Caching normalised
    # timestamps would re-apply the era offset on every reload — a silent +4 h
    # drift on 43% of the book that would look like data, not a bug.
    rows = None
    if cache_path and os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as fh:
            rows = json.load(fh)
    elif cache_path:
        rows = _load_rows_via_ssh(_DEFAULT_DB)
        with open(cache_path, "w", encoding="utf-8") as fh:
            json.dump(rows, fh)

    try:
        trades, skipped = load_book(rows=rows)
    except BookLoadError as exc:
        print(json.dumps({"error": str(exc)}))
        return 2

    report = replay_identity(trades)
    report["book_size"] = len(trades)
    report["skipped_rows"] = skipped
    print(json.dumps(report, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
