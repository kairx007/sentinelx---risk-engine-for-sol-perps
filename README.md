# Solana Perpetuals Risk Engine

An open-source risk intelligence system for Solana perpetual markets. The project will collect venue data, normalize it, calculate deterministic and explainable risk metrics, and expose those results through an API and dashboard.

## Project status

The collector currently exposes a read-only Velocity perp market adapter. See
[Velocity Adapter](./docs/velocity-adapter.md) for setup and data coverage.
The phased roadmap is in [plan.md](./plan.md).

## Requirements

- [Bun](https://bun.sh/) 1.3 or newer

## Setup

```sh
bun install
bun run typecheck
bun run test
bun run build
```

Use `bun run lint` and `bun run format:check` to check code style. Copy `.env.example` to `.env` when local environment values are needed.

## Repository layout

- `apps/` — API, collector, and dashboard applications
- `packages/` — shared types, metrics, risk, and venue adapters
- `tests/` — fixtures and integration tests
- `docs/` — project documentation

## Velocity market data

The Velocity adapter subscribes to current perp market and oracle accounts with
the official SDK, then returns a validated canonical `MarketState`. It is
read-only and does not submit transactions. Velocity is a separate program
deployment from Drift with different account addresses and USDT-quoted mainnet
markets; it is not a decoder replacement for Drift V2.

## License

MIT. See [LICENSE](./LICENSE).
