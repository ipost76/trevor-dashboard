#!/usr/bin/env python3
"""
set_dca.py — Hub WRITE dispatcher for /api/dca POST.

Usage:
    set_dca.py <action>   (JSON body via stdin)

Actions:
    add     — body: {ticker, amount, frequency?, day_of_week?, notes?}  → {ok, id}
    remove  — body: {ticker}                                             → {ok}
    edit    — body: {ticker, amount?, frequency?, day_of_week?, notes?} → {ok}
    pause   — body: {ticker}                                             → {ok}
    resume  — body: {ticker}                                             → {ok}

Exit codes:
    0  success
    1  usage / unknown action
    2  DB / unexpected error
    4  invalid input (bad JSON / missing required fields / bad enum)
"""
import json
import sys

sys.path.insert(0, "/home/trevor/trevor")

DB_PATH = "/home/trevor/trevor/trevor.db"
VALID_ACTIONS = ("add", "remove", "edit", "pause", "resume")
VALID_FREQUENCIES = ("daily", "weekly", "biweekly", "monthly")
VALID_DAYS = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")


def _emit(payload: dict, code: int = 0) -> None:
    print(json.dumps(payload))
    sys.exit(code)


def _read_ticker(body: dict) -> str:
    raw = (body.get("ticker") or "").strip().upper()
    if not raw:
        _emit({"ok": False, "error": "ticker required"}, code=4)
    return raw


def _read_amount(body: dict, required: bool = True) -> float:
    raw = body.get("amount")
    if raw is None or raw == "":
        if required:
            _emit({"ok": False, "error": "amount required"}, code=4)
        return None  # type: ignore[return-value]
    try:
        amt = float(raw)
    except (TypeError, ValueError):
        _emit({"ok": False, "error": "amount must be a number"}, code=4)
        return 0.0
    if amt <= 0:
        _emit({"ok": False, "error": "amount must be > 0"}, code=4)
    return amt


def _validate_freq(freq: str) -> str:
    fl = freq.strip().lower()
    if fl not in VALID_FREQUENCIES:
        _emit({"ok": False, "error": f"invalid frequency: {freq}"}, code=4)
    return fl


def _validate_day(day: str) -> str:
    du = day.strip().upper()
    if du not in VALID_DAYS:
        _emit({"ok": False, "error": f"invalid day_of_week: {day}"}, code=4)
    return du


def main() -> None:
    if len(sys.argv) < 2:
        _emit({"ok": False, "error": "Usage: set_dca.py <action>"}, code=1)

    action = sys.argv[1].strip().lower()
    if action not in VALID_ACTIONS:
        _emit({"ok": False, "error": f"unknown action: {action}"}, code=1)

    raw_body = sys.stdin.read().strip() or "{}"
    try:
        body = json.loads(raw_body)
    except Exception as e:
        _emit({"ok": False, "error": f"invalid JSON body: {e}"}, code=4)

    if not isinstance(body, dict):
        _emit({"ok": False, "error": "body must be a JSON object"}, code=4)

    try:
        from dca_manager import DCAManager
        dm = DCAManager(DB_PATH)

        if action == "add":
            ticker = _read_ticker(body)
            amount = _read_amount(body, required=True)
            frequency = _validate_freq(body.get("frequency") or "daily")
            day_of_week = body.get("day_of_week")
            if day_of_week:
                day_of_week = _validate_day(str(day_of_week))
            elif frequency in ("weekly", "biweekly"):
                _emit({"ok": False, "error": "day_of_week required for weekly/biweekly"}, code=4)
            else:
                day_of_week = None
            notes = (body.get("notes") or "").strip()
            rid = dm.add(ticker, amount, frequency, day_of_week, notes)
            _emit({"ok": True, "id": int(rid), "ticker": ticker}, code=0)

        elif action == "remove":
            ticker = _read_ticker(body)
            ok = dm.remove(ticker)
            _emit({"ok": bool(ok), "ticker": ticker}, code=0 if ok else 4)

        elif action == "edit":
            ticker = _read_ticker(body)
            kwargs = {}
            if "amount" in body and body["amount"] not in (None, ""):
                kwargs["amount"] = _read_amount(body, required=False)
            if "frequency" in body and body["frequency"]:
                kwargs["frequency"] = _validate_freq(str(body["frequency"]))
            if "day_of_week" in body:
                dow = body["day_of_week"]
                kwargs["day_of_week"] = _validate_day(str(dow)) if dow else None
            if "notes" in body:
                kwargs["notes"] = str(body["notes"] or "").strip()
            if not kwargs:
                _emit({"ok": False, "error": "no fields to edit"}, code=4)
            ok = dm.edit(ticker, **kwargs)
            _emit({"ok": bool(ok), "ticker": ticker}, code=0 if ok else 4)

        elif action == "pause":
            ticker = _read_ticker(body)
            ok = dm.pause(ticker)
            _emit({"ok": bool(ok), "ticker": ticker}, code=0 if ok else 4)

        elif action == "resume":
            ticker = _read_ticker(body)
            ok = dm.resume(ticker)
            _emit({"ok": bool(ok), "ticker": ticker}, code=0 if ok else 4)

    except SystemExit:
        raise
    except Exception as e:
        _emit({"ok": False, "error": str(e)}, code=2)


if __name__ == "__main__":
    main()
