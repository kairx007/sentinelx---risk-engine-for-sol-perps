# Phase 7: Risk Policy Integration

## Architecture map

```text
Velocity adapter ─┐
                  ├─> canonical MarketState ─> venue risk ─┐
Phoenix adapter ──┘                                        │
                                           cross-venue risk + contagion
                                                         │
                                                  deterministic policy
                                                         │
                                      Risk authority signs update_risk_state
                                                         │
                                      RiskState PDA ─> position exposure gate
                                                         │
                                      Pyth PriceUpdateV2 ─> valuation/liquidation
```

The venue adapters remain responsible for provider-specific collection and normalization. The risk and cross-venue packages consume only `MarketState`. The one-shot `@perps-risk/risk-publisher` command calls both existing adapters, rejects partial collection, mismatched venue/asset identity, missing market IDs, and stale observations, then uses the existing policy mapper.

## Trust boundaries

- Velocity and Phoenix provide ecosystem observations. Their prices do not feed the on-chain position valuation path.
- The policy mapper selects the maximum of the two venue risk scores and the ecosystem score, maps the score to the established LOW/MEDIUM/HIGH/CRITICAL bands, then applies contagion caps.
- The configured `risk_authority` key signs only the bounded `update_risk_state` instruction. The on-chain program remains authoritative for signer, vault/PDA, enum, score-level match, leverage cap, timestamp, freshness, and exact-next-nonce checks.
- Pyth `PriceUpdateV2` remains the only Phase 6 source for position valuation, margin, and liquidation.
- The on-chain program controls user shares, collateral, positions, and liquidation. The off-chain publisher cannot set balances, PnL, or position state.

## Policy observation and freshness

`observed_at` comes from the source observation time in canonical market state, using the older of the Velocity and Phoenix observations. It is not reset to the local collection or publishing time. The mapper rejects stale/missing source freshness, absent or malformed observation timestamps, invalid risk scores, asset disagreement, and unavailable venue results. A venue collection failure stops publication; it is never replaced by a low-risk or zero-risk result.

On-chain `RiskState.updated_at` is set from the Solana Clock when the transaction executes. `RiskState.observed_at` records the older source timestamp. New exposure continues to require fresh RiskState; reduction and close remain allowed when it is stale; liquidation remains independent of RiskState freshness and requires a valid Phase 6 oracle/maintenance check.

## Publisher and nonce operation

The publisher is deliberately one-shot; deployment scheduling is an operator choice and no service endpoint accepts arbitrary policy updates. Configure:

```sh
MARKET_RPC_URL=https://...       # Velocity market data RPC (mainnet-beta by default)
SOLANA_RPC_URL=https://...       # cluster where the Risk Vault is deployed
RISK_VAULT_ADDRESS=<vault PDA>
RISK_AUTHORITY_KEYPAIR=/secure/path/to/risk-authority.json
MARKET_SYMBOL=SOL-PERP
PHOENIX_API_URL=https://...      # optional, adapter default otherwise
```

Run `bun run --filter @perps-risk/risk-publisher publish-once`. Keep the authority key outside the repository and use the key configured in the vault. Before constructing an instruction the client reads the vault, checks its owner/discriminator/PDA and confirms its configured risk authority equals the signer. It reads the current RiskState PDA, validates the program owner/discriminator/bump, and uses exactly `current nonce + 1`. A stale policy cannot overwrite a later observation. Duplicate current policies are no-ops. After confirmed submission the publisher rereads and verifies the exact nonce and policy fields. If confirmation fails, it rereads chain state before deciding whether the same update already landed; it never guesses or skips a nonce.

The client instruction encoder is tied to the current generated Anchor IDL discriminator and the Rust Borsh field order. `update_risk_state` accepts six arguments; `updated_at` is chain-generated and is not a client argument. The on-chain program performs the final validation even when the client also rejects malformed policy values.

## Data validation and failures

Each adapter validates and normalizes its provider response through `MarketStateSchema`. A publisher run requires both venue calls to succeed and both states to have matching base assets, correct venue identities, market IDs, fresh source data, and timestamps. Optional metric fields can remain `null`; a whole venue or required observation becoming unavailable blocks the policy publication.

The command emits structured JSON logs for collection failures, policy generation, update attempts, confirmed success (including signature when published), and failures. It does not persist risk calculations or introduce a queue/database.

## `settlement_reserved`

`settlement_reserved` is quarantined existing collateral after a loss-making reduction, close, or liquidation. It is subtracted from free collateral in both exposure increases and withdrawals. No current instruction decrements it. It represents neither realized PnL nor a vault liability settled with another depositor's assets. A future release mechanism needs a separately reviewed settlement design; Phase 7 adds none.

## Account layout and deployment safety

- `Vault` retains its Phase 1 layout and PDA seed `[b"vault", collateral_mint]`.
- `RiskState` retains its Phase 4 layout and PDA seed `[b"risk_state", vault]`.
- `UserVaultAccount` gained `settlement_reserved`; pre-Phase-6 accounts have an incompatible shorter layout.
- `Position` gained Phase 6 valuation fields/schema version while retaining its existing PDA seed `[b"position", vault, owner, market]`; pre-Phase-6 position bytes are incompatible.
- `MarketConfig` is a new PDA at `[b"market_config", vault, market]` and must be initialized for each supported market.
- The program ID remains `33fMx1DC1XXdSYXG8VUFqH5y1gDqxmEpbTTwESx21Rtq` in this implementation.

No account migration exists. Do not upgrade a live deployment and assume old `UserVaultAccount` or `Position` data remains readable. Preserving existing funds/positions requires a separately designed and audited migration or a coordinated fresh deployment with an explicit asset/position transition plan. A fresh program ID changes PDA addresses; retaining the current ID without migration leaves the changed account layouts incompatible. No deployment or migration is performed by Phase 7.

## Deferred protocol behavior

PnL settlement, funding, insurance/backstop, loss socialization, partial liquidation, liquidation rewards, cross-margin, and venue execution remain unimplemented. No claim of production oracle-feed configuration or live-cluster readiness is made by the publisher tests.
