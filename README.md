# Solana Perpetuals Risk Engine

An open-source risk intelligence system for Solana perpetual markets. The project will collect venue data, normalize it, calculate deterministic and explainable risk metrics, and expose those results through an API and dashboard.

## Project status

Phase 1 establishes the repository and development tooling. Product logic and venue integrations have not been implemented yet. See [plan.md](./plan.md) for the phased roadmap.

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

## License

MIT. See [LICENSE](./LICENSE).
