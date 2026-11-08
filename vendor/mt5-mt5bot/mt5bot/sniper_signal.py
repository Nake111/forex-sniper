"""Validated reader for the Node.js Forex Sniper signal contract.

This module deliberately does not place orders. It rejects HOLD/NO TRADE,
stale records, malformed plans, and symbol mismatches before an execution
adapter is allowed to act on a signal.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class SniperTradePlan:
    symbol: str
    side: str
    generated_at: datetime
    signal_bar_time: datetime
    entry: float
    stop_loss: float
    take_profit: float
    risk_reward: str


def _timestamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be an ISO-8601 string")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field} is not a valid ISO-8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)


def load_trade_plan(
    path: str | Path,
    *,
    expected_symbol: str,
    now: datetime | None = None,
    max_age_seconds: int = 600,
) -> SniperTradePlan:
    """Load a fresh executable BUY/SELL plan; raise ValueError otherwise."""
    if max_age_seconds <= 0:
        raise ValueError("max_age_seconds must be positive")
    try:
        record = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read Sniper signal file: {exc}") from exc
    if not isinstance(record, dict) or record.get("schemaVersion") != 1:
        raise ValueError("unsupported or missing signal schemaVersion")
    symbol = record.get("symbol")
    if symbol != expected_symbol:
        raise ValueError(f"symbol mismatch: expected {expected_symbol}, got {symbol!r}")
    if record.get("action") not in ("BUY", "SELL"):
        raise ValueError(f"signal is not executable: {record.get('action')!r}")
    generated = _timestamp(record.get("generatedAt"), "generatedAt")
    bar_time = _timestamp(record.get("signalBarTime"), "signalBarTime")
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    age = (current.astimezone(timezone.utc) - generated).total_seconds()
    if age < -30 or age > max_age_seconds:
        raise ValueError(f"stale or future signal: age={age:.1f}s")
    if bar_time > generated:
        raise ValueError("signal bar timestamp is later than generation time")
    plan = record.get("plan")
    if not isinstance(plan, dict):
        raise ValueError("executable signal has no trade plan")
    values = {key: plan.get(key) for key in ("entry", "stopLoss", "takeProfit")}
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
           for v in values.values()):
        raise ValueError("entry, stopLoss and takeProfit must be finite numbers")
    entry, stop, target = (float(values[k]) for k in ("entry", "stopLoss", "takeProfit"))
    side = record["action"]
    if side == "BUY" and not stop < entry < target:
        raise ValueError("BUY plan levels must satisfy stopLoss < entry < takeProfit")
    if side == "SELL" and not target < entry < stop:
        raise ValueError("SELL plan levels must satisfy takeProfit < entry < stopLoss")
    return SniperTradePlan(
        symbol=symbol,
        side=side,
        generated_at=generated,
        signal_bar_time=bar_time,
        entry=entry,
        stop_loss=stop,
        take_profit=target,
        risk_reward=str(plan.get("riskReward", "")),
    )
