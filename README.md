# Solana Perpetuals Risk Engine

An open-source risk intelligence system for Solana perpetual markets. The project will collect venue data, normalize it, calculate deterministic and explainable risk metrics, and expose those results through an API and dashboard.

## Project status

The API exposes read-only Velocity and Phoenix market/risk views. The separate
`@perps-risk/risk-publisher` command can publish a deterministic ecosystem
policy using the vault's configured risk-authority key; it is an explicit
one-shot command and never accepts arbitrary policy updates over the API. See
[Velocity Adapter](./docs/velocity-adapter.md) and
[Phase 7 integration](./docs/phase-7-integration.md). The phased roadmap is in
[plan.md](./plan.md).

## Requirements

- [Bun](https://bun.sh/) 1.3 or newer

## Setup

```sh
bun install
bun run typecheck
bun run test
bun run build
```

Tests can also be run by layer:

```sh
bun run test:unit        # shared package tests
bun run test:integration # application and repository level tests
bun run test:anchor      # Rust Anchor program tests (LiteSVM)
bun run test:all         # all three layers
```

Use `bun run lint` and `bun run format:check` to check code style. Copy `.env.example` to `.env` when local environment values are needed.

## Repository layout

- `apps/` — API, collector, and dashboard applications
- `packages/` — shared types, metrics, risk, and venue adapters
- `apps/*/tests/` and `packages/*/tests/` — dedicated tests kept outside production `src/` folders
- `tests/` — shared fixtures and repository level contract tests
- `anchor/risk_vault/programs/risk_vault/tests/` — on-chain program tests
- `docs/` — project documentation

## Velocity market data

The Velocity adapter subscribes to current perp market and oracle accounts with
the official SDK, then returns a validated canonical `MarketState`. It is
read-only and does not submit transactions. Velocity is a separate program
deployment from Drift with different account addresses and USDT-quoted mainnet
markets; it is not a decoder replacement for Drift V2.

## License

MIT. See [LICENSE](./LICENSE).
