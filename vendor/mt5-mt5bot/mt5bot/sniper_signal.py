"""Validated reader for the Node.js Forex Sniper signal contract.

This module is independent of MetaTrader. It rejects HOLD, stale, malformed,
and mismatched signals before an execution adapter can use a trade plan.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class SniperTradePlan:
    """An immutable, validated trade plan emitted by Forex Sniper."""

    symbol: str
    side: str
    generated_at: datetime
    signal_bar_time: datetime
    entry: float
    stop_loss: float
    take_profit: float
    risk_reward: str


def _timestamp(value: Any, field: str) -> datetime:
    """Parse an ISO-8601 timestamp and require an explicit timezone."""
    if not isinstance(value, str):
        raise ValueError(f"{field} must be an ISO-8601 string")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field} is not a valid ISO-8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field} must include a timezone")
    return parsed.astimezone(UTC)


def _price(plan: dict[str, Any], key: str) -> float:
    """Return a finite positive price, rejecting booleans and numeric strings."""
    value = plan.get(key)
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value <= 0
    ):
        raise ValueError(f"plan.{key} must be a finite positive number")
    return float(value)


def load_trade_plan(
    path: str | Path,
    *,
    expected_symbol: str,
    now: datetime | None = None,
    max_age_seconds: int = 600,
) -> SniperTradePlan:
    """Load a fresh executable BUY/SELL plan or raise ValueError."""
    if not expected_symbol or not expected_symbol.strip():
        raise ValueError("expected_symbol must be a non-empty string")
    if max_age_seconds <= 0:
        raise ValueError("max_age_seconds must be positive")

    try:
        record = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read Sniper signal file: {exc}") from exc

    if not isinstance(record, dict) or record.get("schemaVersion") != 1:
        raise ValueError("unsupported or missing signal schemaVersion")

    symbol = record.get("symbol")
    if not isinstance(symbol, str) or symbol != expected_symbol:
        raise ValueError(f"symbol mismatch: expected {expected_symbol}, got {symbol!r}")

    action = record.get("action")
    if action not in ("BUY", "SELL"):
        raise ValueError(f"signal is not executable: {action!r}")
    if record.get("candidate") != action:
        raise ValueError("candidate and final action do not match")
    if record.get("confirmation") != "H1 ALIGNED":
        raise ValueError("signal does not have H1 ALIGNED confirmation")

    generated = _timestamp(record.get("generatedAt"), "generatedAt")
    bar_time = _timestamp(record.get("signalBarTime"), "signalBarTime")
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    current_utc = current.astimezone(timezone.utc)

    age = (current_utc - generated).total_seconds()
    if age < -30 or age > max_age_seconds:
        raise ValueError(f"stale or future signal: age={age:.1f}s")
    bar_age = (current_utc - bar_time).total_seconds()
    if bar_age < -30 or bar_age > max_age_seconds:
        raise ValueError(f"stale or future signal bar: age={bar_age:.1f}s")
    if bar_time > generated:
        raise ValueError("signal bar timestamp is later than generation time")

    plan = record.get("plan")
    if not isinstance(plan, dict):
        raise ValueError("executable signal has no trade plan")

    entry = _price(plan, "entry")
    stop = _price(plan, "stopLoss")
    target = _price(plan, "takeProfit")
    if action == "BUY" and not stop < entry < target:
        raise ValueError("BUY plan levels must satisfy stopLoss < entry < takeProfit")
    if action == "SELL" and not target < entry < stop:
        raise ValueError("SELL plan levels must satisfy takeProfit < entry < stopLoss")

    return SniperTradePlan(
        symbol=symbol,
        side=action,
        generated_at=generated,
        signal_bar_time=bar_time,
        entry=entry,
        stop_loss=stop,
        take_profit=target,
        risk_reward=str(plan.get("riskReward", "")),
    )
