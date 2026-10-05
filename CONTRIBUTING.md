# Contributing

Thanks for contributing. The project follows the phase order in [plan.md](./plan.md); keep changes focused on the active phase and avoid introducing later-phase business logic early.

## Development

1. Install Bun 1.3 or newer.
2. Run `bun install`.
3. Make focused changes in the relevant app or package.
4. Run `bun run format`, `bun run lint`, `bun run typecheck`, `bun run test`, and `bun run build` before opening a pull request.

Use deterministic, explainable code and add focused tests for implemented functionality. Do not commit secrets or local `.env` files.
