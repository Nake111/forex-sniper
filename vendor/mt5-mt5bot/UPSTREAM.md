# Vendored MT5 trading framework

This directory contains a copy of [ilyasyldrm0/MetaTrader5-BOT](https://github.com/ilyasyldrm0/MetaTrader5-BOT), pinned to upstream commit `6ed67cf51d5f1dcf9df720329656ccdb0186a4c0`.

- Upstream license: MIT; see [LICENSE.md](LICENSE.md).
- Upstream project provides an MT5 adapter, paper/dry-run broker, backtester, configurable RSI/SMA strategy, risk sizing and a CLI.
- It is included as an isolated Python subproject; it does not replace the existing Node.js Forex Sniper.
- Live MT5 execution requires a Windows machine with MetaTrader 5 installed and logged in. It has not been connected to Vantage or validated on your account.
- Upstream README explicitly reports that its default RSI/SMA strategy produced zero signals on its bundled 4,000-bar synthetic sample. It is an execution/backtesting framework, not evidence of profitability.
- Run in paper mode first. No live trading is enabled by this copy.

Source: https://github.com/ilyasyldrm0/MetaTrader5-BOT
