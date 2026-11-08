from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from mt5bot.sniper_signal import load_trade_plan


def write_signal(path, **overrides):
    record = {
        "schemaVersion": 1,
        "symbol": "BTCUSD",
        "generatedAt": "2026-11-08T06:00:00Z",
        "signalBarTime": "2026-11-08T05:55:00Z",
        "timeframe": "M5",
        "candidate": "BUY",
        "confirmation": "H1 ALIGNED",
        "action": "BUY",
        "plan": {"entry": 100.0, "stopLoss": 98.5, "takeProfit": 103.0, "riskReward": "1:2"},
    }
    record.update(overrides)
    path.write_text(json.dumps(record), encoding="utf-8")


def test_loads_valid_buy_plan(tmp_path):
    path = tmp_path / "signal.json"
    write_signal(path)
    now = datetime(2026, 11, 8, 6, 1, tzinfo=timezone.utc)
    plan = load_trade_plan(path, expected_symbol="BTCUSD", now=now)
    assert plan.side == "BUY"
    assert (plan.entry, plan.stop_loss, plan.take_profit) == (100.0, 98.5, 103.0)


def test_rejects_hold_signal(tmp_path):
    path = tmp_path / "signal.json"
    write_signal(path, action="NO TRADE", plan=None)
    with pytest.raises(ValueError, match="not executable"):
        load_trade_plan(path, expected_symbol="BTCUSD")


def test_rejects_wrong_symbol(tmp_path):
    path = tmp_path / "signal.json"
    write_signal(path)
    with pytest.raises(ValueError, match="symbol mismatch"):
        load_trade_plan(path, expected_symbol="EURUSD")


def test_rejects_stale_signal(tmp_path):
    path = tmp_path / "signal.json"
    write_signal(path)
    now = datetime(2026, 11, 8, 7, 0, tzinfo=timezone.utc)
    with pytest.raises(ValueError, match="stale or future"):
        load_trade_plan(path, expected_symbol="BTCUSD", now=now, max_age_seconds=600)


def test_rejects_invalid_buy_levels(tmp_path):
    path = tmp_path / "signal.json"
    write_signal(path, plan={"entry": 100.0, "stopLoss": 101.0, "takeProfit": 103.0})
    now = datetime(2026, 11, 8, 6, 1, tzinfo=timezone.utc)
    with pytest.raises(ValueError, match="BUY plan levels"):
        load_trade_plan(path, expected_symbol="BTCUSD", now=now)
