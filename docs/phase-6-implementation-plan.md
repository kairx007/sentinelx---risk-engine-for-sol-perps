# Phase 6 — Oracle, PnL, Margin & Liquidation Implementation Plan

**Status:** Architecture proposal for review; no Phase 6 code is implemented by this document.

**Classification key:** **MUST HAVE** is required for a safe, demonstrable MVP; **SHOULD HAVE** is strongly recommended for the protocol design; **OPTIONAL** can follow if time permits; **DEFER** is explicitly out of scope for Phase 6.

## 1. Executive summary

**Recommendation — Option B, narrowed to isolated per-position collateral and single-market accounting.** Phase 5 has position bookkeeping and an exposure cap, but no price source, entry price, PnL, equity, margin threshold, or liquidation path. Adding a price check alone would not make the current positions liquidatable: `size` and `notional` are caller-supplied and their units are not specified in the on-chain account schema. The first implementation step must resolve units and position semantics before an oracle or PnL formula is coded.

For the hackathon MVP, implement a venue-neutral, configured oracle boundary; one auditable integer price representation; entry/average-entry tracking; deterministic unrealized PnL; isolated equity and maintenance checks; and permissionless **full** liquidation that closes one position at a validated price snapshot. Keep new exposure behind the existing authenticated, fresh `RiskState` policy. Liquidation must depend on a fresh valid oracle and position-local state, not on `RiskState` freshness. Do not claim this is an exchange: there is no order execution, funding, insurance fund, cross-margin, or automatic guarantee against bad debt.

**Scope recommendation:** Option A is too small to be meaningfully risk-managed without a liquidation and loss-accounting decision. Full Option B with partial liquidation/rewards is too broad for the present prototype. Option C is not appropriate. Implement the safe core of B with isolated positions and full close; defer partial liquidation, rewards, insurance, and venue execution.

## 2. Current architecture assessment

Existing flow is: off-chain collectors/adapters and risk engine → authenticated risk authority publishes `RiskState` → `increase_position` validates policy → `Position` and `UserVaultAccount` track exposure/collateral. The Anchor program has no Velocity or Phoenix CPI and no on-chain market-data reader.

The Rust test suite uses LiteSVM. `Anchor.toml` sets `skip_local_validator = true` and `[scripts].test = "cargo test"`; the existing tests are Rust tests, not validator-backed TypeScript integration tests. Existing client adapters in this repository are read-only data collectors and do not submit venue transactions.

## 3. Phase 6 goals

- **MUST HAVE:** Give every position a well-defined base quantity, quote/collateral denomination, entry price, and valuation formula.
- **MUST HAVE:** Reject malformed, mismatched, stale, future-dated, nonpositive, or over-uncertain oracle observations before valuation or liquidation.
- **MUST HAVE:** Compute unrealized PnL, equity, maintenance requirement, and liquidation eligibility with checked integer arithmetic.
- **MUST HAVE:** Make liquidation atomic, permissionless to trigger, position-specific, and impossible for a healthy position.
- **MUST HAVE:** Preserve the Phase 4 rule that only fresh, authenticated `RiskState` can authorize exposure increases.
- **SHOULD HAVE:** Make oracle and risk parameters explicit per market with bounded authority-controlled configuration.

## 4. Explicit non-goals

- **DEFER:** Funding payments, funding index, or exchange settlement.
- **DEFER:** Mark/index price construction from venue microstructure, basis, or cross-venue feeds.
- **DEFER:** Venue execution, automatic order placement, Velocity/Phoenix CPI, or keeper bots.
- **DEFER:** Cross-position or cross-market margin and portfolio netting.
- **DEFER:** Insurance fund, socialized loss, backstop liquidity, and a claim on vault shares for unrealized losses.
- **DEFER:** Dynamic on-chain OI, liquidity, volatility, liquidation-pressure, funding, or contagion analytics.
- **DEFER:** Partial liquidation and keeper reward until full-close loss accounting and bad-debt policy are proven.
- **OPTIONAL:** A production oracle provider adapter beyond the first selected source and a deterministic test oracle.

## 5. Repository audit

### EXISTS

- `state.rs`: `Vault`, `UserVaultAccount`, `Position`, `RiskState`, position side/status, risk level, and contagion enums. `Position` stores owner, vault, opaque market pubkey, side, `size: u64`, `notional: u64`, `collateral_locked: u64`, `opened_at`, status, and bump. It stores no price, entry, PnL, or margin fields.
- `constants.rs`: PDA seeds; RiskState max age 300 seconds and future skew 30 seconds; policy leverage caps.
- `errors.rs`: arithmetic, conversion, policy, position, collateral, and reduction errors. No oracle/PnL/margin/liquidation errors.
- `math.rs`: checked `u128` share conversion and leverage calculation; division truncates down. No price/PnL functions.
- `policy.rs`: fresh/nonzero initialized `RiskState` required for `IncreaseExposure`; reduction, close, and withdraw bypass freshness. RiskState maps risk/contagion into caps.
- `lib.rs`: initialize, deposit, withdraw, update/rotate risk authority, increase, reduce, and close instructions only.
- `increase_position.rs`: caller supplies positive `size_delta` and `notional_delta`, collateral is separately supplied, leverage uses resulting notional/locked collateral, and the Position PDA is `[position, vault, owner, market]`. Market is an unchecked opaque identifier except non-default key/PDA binding.
- `reduce_position.rs`: caller supplies size and notional reduction; locked collateral is released pro rata by notional, rounding down except full notional releases all. No price or PnL settlement.
- `close_position.rs`: owner closes; all locked collateral returns to free accounting with no PnL settlement.
- `UserVaultAccount`: shares and aggregate locked collateral only. User collateral value is calculated from vault deposit/share ratio; shares do not presently track PnL/equity.
- `Vault`: total deposits/shares and collateral mint; vault ATA holds collateral.
- `update_risk_state.rs`: risk authority signature, bounded score/level/cap, freshness, future skew, exact nonce. The update does not contain market oracle or maintenance parameters.
- LiteSVM tests cover vault/deposit/withdraw, policy, position accounting, risk state, rounding, and atomic failures. Existing position tests confirm only simple numeric quantities (e.g. size 100, notional 300, locked 100), without a declared unit or market price.
- Off-chain Velocity adapter reads oracle, reserve/mark estimates, OI and funding into canonical market data; this adapter is read-only. Drift adapter is also read-only. There is no Phoenix adapter shown in the audited docs; the user-provided architecture may represent a broader risk-engine integration.

### NEEDS MODIFICATION

- `Position` and increase/reduce/close semantics must change to bind position quantity and realized/unrealized value to price. This is an Anchor account layout change and needs an explicit migration/reinitialization strategy.
- `market` must become a configured market identity, rather than any non-default signer-provided pubkey, before an oracle feed can be safely associated with it.
- Vault/user collateral rules must make clear whether locked collateral is isolated backing, and prevent withdrawals that would violate the new collateral-liability model.
- Existing tests that pass arbitrary size/notional values must be updated to use declared units and oracle accounts. All Phase 1–5 regression behavior remains required.

### NEW

- Oracle validation module and provider-specific decoder/adapter (or documented generic account format).
- A market configuration authority and bounded feed/market mapping, if no existing account can safely own that mapping.
- Checked fixed-point conversion, PnL, equity, margin, and liquidation eligibility helpers.
- Price-aware position-open/increase and reduce/close settlement flows; a permissionless liquidation instruction; dedicated errors/events.
- LiteSVM oracle fixtures and Phase 6 invariant/atomicity tests.

### DEFERRED

- Funding settlement; mark/index derivation; multi-market/cross-margin; insurance; liquidation incentive; partial liquidation; execution CPI; venue-specific accounts and risk analytics.

## 6. Recommended scope and option evaluation

| Option | Assessment | Classification |
|---|---|---|
| A — price, PnL, ratio, basic liquidation | Leaves important maintenance and liquidation policy underspecified; insufficient alone for a risk-managed perp claim. | **OPTIONAL** only as a throwaway internal prototype; not the recommended deliverable. |
| B — validated oracle through liquidation | Appropriate if narrowed to isolated collateral, one configured price per market, deterministic maintenance threshold, and full liquidation. This closes the core safety loop while remaining venue-agnostic. | **MUST HAVE** recommended core. |
| C — complete perps layer | Adds complex settlement, cross-margin, funding, incentives, insurance, and venue effects unrelated to the project's risk-policy differentiator. | **DEFER**. |

## 7. Oracle design

### Smallest safe abstraction

- **MUST HAVE:** A market configuration maps the market PDA/key to an expected oracle account/feed identity, quote denomination, supported price precision/range, maximum confidence ratio, and freshness policy. The program verifies account owner, discriminator/layout, feed identity, and any feed-to-market mapping. A caller-supplied price instruction argument is not an oracle.
- **MUST HAVE:** Consume a standard Solana oracle account directly for the MVP. Pyth is a reasonable first provider because the off-chain Velocity adapter already distinguishes oracle/index price from reserve/mark price, but its on-chain account format, SDK compatibility with the pinned Anchor/Solana versions, feed IDs, and publish-time semantics must be confirmed in a short implementation spike before committing to it. Do not infer that the Velocity account is Pyth-compatible from the off-chain adapter.
- **SHOULD HAVE:** Keep decoding isolated behind `oracle` module functions (`load_and_validate_price`), with provider-specific account parsing and a normalized `ValidatedPrice`; this is sufficient abstraction. Do not create a trait hierarchy or attempt runtime provider polymorphism in the BPF program.
- **MUST HAVE for tests:** A mock/test oracle account format can be installed into LiteSVM; it must not be accepted by production instructions unless it is explicitly the configured provider/program. Test fixtures must exercise the same normalized validation path.

### Required normalized observation

- `price`: positive signed integer in oracle-native precision.
- `exponent`: signed scale if native provider uses exponent encoding.
- `publish_time`: signed Unix seconds.
- `confidence`: nonnegative uncertainty in the same units as price, if source supplies it.
- `feed identity`: provider-specific feed key/ID validated against market configuration.
- source/program owner comes from the account owner and configured provider ID, not a freely set field.

`source` string, collection timestamp, reserve/mark price, and display metadata are not needed in the on-chain normalized record. Preserve the source through the validated account key/config binding.

### Validation and freshness

- **MUST HAVE:** Reject wrong owner/program, wrong account discriminator/length, wrong feed ID, invalid exponent outside explicitly supported bounds, price `<= 0`, negative confidence, confidence greater than price, confidence ratio above configured maximum, and publish time outside allowed clock window.
- **MUST HAVE:** Reject future `publish_time` using a bounded future skew and stale data using a maximum age.
- **MUST HAVE:** Do not copy RiskState's 300-second age and 30-second skew automatically. An oracle age appropriate for liquidating a perp is materially shorter and provider/market dependent. Set and document exact `MAX_ORACLE_AGE_SECONDS`, `MAX_FUTURE_SKEW_SECONDS`, and confidence limits only after confirming provider update cadence, transaction latency, feed type, and deployment target. The values must be constants/configuration with hard on-chain bounds and dedicated tests; they are release-blocking parameters, not arbitrary defaults.
- **SHOULD HAVE:** Reject price observations whose normalized value cannot fit the protocol's configured price range before converting or multiplying.
- **MUST HAVE:** The oracle observation in one instruction is the authoritative transaction input. Solana instruction execution is atomic against that transaction's account snapshot; a later oracle update cannot alter the value mid-instruction. Freshness bounds define acceptable age at execution.

Extreme-deviation validation requires a trusted prior observation or independent reference and can reject legitimate gaps. Do not add a one-feed circuit breaker pretending to be independent protection. **OPTIONAL:** A configured bounded deviation guard if a second trusted reference is later available.

## 8. Price representation

| Representation | Pros | Risks/limitations |
|---|---|---|
| `u64` fixed decimal | Simple positive prices and arithmetic. | Scale/precision is implicit; conversion from provider exponent can lose precision. |
| `i64` fixed decimal | Represents signed PnL-like values. | Oracle price should never be signed; conflates price and PnL domains. |
| integer plus exponent | Preserves oracle precision, compact and natural for Pyth-like feeds. | Mixed exponents require explicit normalization before comparison/multiplication. |
| Q-format | Explicit binary scale and deterministic. | Less intuitive for oracle decimals and client tooling; conversion complexity. |
| Oracle-native | No input conversion for provider. | Couples core accounting and clients to provider encoding. |

**Recommendation — MUST HAVE:** Normalize validated positive oracle prices to a documented decimal fixed-point format using a per-protocol constant scale, and store positions' entry price in that same format. Select the decimal scale only after the quote-token decimal and supported price range are fixed. Store prices as positive `u64`; represent signed PnL separately as `i128` intermediate/result or checked signed magnitude as account-size constraints require. Perform conversions using checked `i128`/`u128`; no floating point. Keep provider exponent in decoding/conversion only unless retaining raw observation is needed for audit/event emission.

A `ValidatedPrice` should include normalized price and publish time for the instruction. An additional persistent price PDA is unnecessary if validated oracle accounts are read directly. If the selected provider's price/confidence scale cannot be safely normalized with the supported bound, reconsider the scale before launch.

## 9. Position schema changes

| Existing field | Assessment / proposal | Classification |
|---|---|---|
| `owner`, `vault`, `market`, `side`, `status`, `bump` | Preserve identity/status/PDA checks. Strengthen `market` through `MarketConfig` and expected oracle feed. | **MUST HAVE** |
| `size: u64` | Currently undefined units; define as base-asset quantity in a fixed base precision, not caller-labelled “size”. | **MUST HAVE** |
| `notional: u64` | Currently caller-supplied quote exposure. It is not enough to recover entry price after price moves and should not be the PnL basis. Replace or clearly redefine as derived current/entry notional; avoid storing duplicate values if derivable. | **MUST HAVE** |
| `collateral_locked: u64` | Preserve as collateral-token units earmarked for this isolated position. Validate aggregate user locked amount against sum/controlled position transitions. | **MUST HAVE** |
| `opened_at` | Preserve as original open time; optional update time is useful for observability but not needed for PnL. | `opened_at` **SHOULD HAVE**; update time **OPTIONAL** |
| entry price | Add `entry_price` in normalized fixed-point units. Needed to compute unrealized PnL. | **MUST HAVE** |
| average entry | With same-side adds, update weighted average entry using base quantity and a defined rounding rule; a separate average field is unnecessary if `entry_price` is explicitly average entry. | **MUST HAVE** |
| realized PnL | Add only if reduce/close settles PnL into collateral/equity atomically. If no realization is paid/charged in the first demo, do not pretend a close settles PnL. | **MUST HAVE** if settlement is in scope; otherwise Phase 6 MVP must limit operations or document no settlement. |
| mark/current price | Do not persist as authoritative current state; it goes stale immediately. | **DEFER** |
| unrealized PnL | Derivable from validated price + position; do not persist it as authoritative state. Emit calculated value if useful. | **SHOULD HAVE** event only |

**Migration:** Adding fields to Anchor accounts changes serialized layout and `INIT_SPACE`; old Position accounts cannot be safely deserialized as the new schema without a versioned migration. This is a prototype, so the clean MVP is a versioned program/account migration decision made before deployment. Either (a) deploy a new program ID/new PDA namespace and require positions to be reopened, or (b) add an explicit version/migration instruction with old-layout decoding and account realloc/rent handling. Do not silently reinterpret old `size` or `notional`. This migration choice is **MUST HAVE** before implementation/deployment.

## 10. PnL model

The formula below applies only after `size` is fixed-point base quantity and prices are normalized quote units per base unit in compatible decimal scales. Let `Q` be base quantity scaled by `S_q`; let entry/current prices be scaled by `S_p`; let collateral quote units be scaled by `S_c`. Normalize after multiplying with checked wide integers.

Conceptually:

- long signed PnL = `Q × (P_now − P_entry)`
- short signed PnL = `Q × (P_entry − P_now)`

Then divide by the combined quantity/price scale with a specified rule. Use signed wide intermediate arithmetic (`i128` if range analysis proves it sufficient; otherwise a multi-limb approach or tighter input bounds). Never cast a negative result to `u64`.

- **MUST HAVE:** Treat additions to an open same-side position as a weighted average entry, not as a simple sum of prices. Compute weighted average using checked products and divide once; explicitly round against the trader for collateral safety (profit rounds down, loss magnitude rounds up).
- **MUST HAVE:** On partial reduction, realize PnL for the reduced base quantity at the validated execution/settlement price, update remaining quantity, and leave average entry unchanged for the remaining quantity. Full close realizes the entire PnL.
- **MUST HAVE:** Decide whether close is a purely accounting close at oracle price or an actual executable venue close. For this venue-agnostic Phase 6, it can only model accounting settlement; it does not trade externally and must be labeled accordingly.
- **MUST HAVE:** Bound max quantity, max price, exponent, and product so all intermediate/result ranges are provably safe. Use checked operations at every multiply/subtract/divide.

The current `notional_delta` alone is insufficient to calculate PnL: it lacks an authoritative price and cannot distinguish the same quote exposure at different quantities/entry prices. The current arbitrary client `size` plus `notional` is not a defensible PnL basis until units and their relationship are fixed.

## 11. Equity model

For an isolated position, define position equity as `collateral_locked + unrealized_pnl` (plus any realized PnL already settled into this position's collateral balance). Do not include user free collateral in maintenance eligibility for MVP; otherwise users can unintentionally cross-margin positions and liquidation must aggregate all markets atomically.

- **MUST HAVE:** Clamp displayed equity at zero for ratio/reporting only; retain signed equity for liquidation/bad-debt calculation. Negative PnL below locked collateral is not made harmless by clamping.
- **MUST HAVE:** `UserVaultAccount.shares` represents a pro-rata claim on vault collateral accounting, not per-position mark-to-market equity. Do not mint/burn shares as PnL changes.
- **MUST HAVE:** Before production, resolve the custody model: the vault currently records deposits and user shares while “locked” is only a counter—there is no transfer of collateral into a per-position escrow. PnL gains cannot be paid from vault assets merely because they appear as positive equity. MVP must either be valuation/liquidation-only with no profit payout, or implement a funded counterparty/pool settlement model; the former is recommended for hackathon demonstration.
- **SHOULD HAVE:** Maintain isolated loss accounting separately so one user's negative PnL cannot silently reduce the redeemable deposits backing other users' shares.

## 12. Initial margin

`RiskState` leverage cap currently constrains the exposure/collateral ratio on increases (e.g. 300 means 3x). This is an entry exposure cap, not an ongoing equity/margin system.

- **MUST HAVE:** Define initial margin from the same allowed leverage rule: `required_initial_collateral = ceil(entry_notional × 10_000 / effective_leverage_x100)` using checked wide integer arithmetic and an explicit quote/collateral conversion. User-supplied collateral must meet the resulting requirement. Existing `RiskState` remains the authority for whether new exposure is allowed and its max leverage.
- **MUST HAVE:** Avoid double counting: actual deposited collateral and collateral assigned to the position need a single accounting source. A configuration bound on max leverage may be used, but user-provided `collateral_delta` cannot be the only check.
- **SHOULD HAVE:** Re-check resulting position leverage on every same-side increase with current entry notional and resulting isolated collateral.
- **DEFER:** On-chain recomputation from off-chain OI, funding, volatility, liquidity, or venue risk inputs.

## 13. Maintenance margin

Maintenance margin is the minimum equity required to keep an isolated open position, not the initial entry deposit. It must be strictly below initial margin at every allowed configuration to leave a liquidation buffer.

- **MUST HAVE:** A fixed, explicit per-market maintenance rate (basis points) with hard protocol min/max and authority-controlled market configuration. Formula: `maintenance = ceil(current_notional × maintenance_bps / 10_000)` with checked arithmetic. Choose rate and bounds from a documented protocol risk decision and stress scenarios; do not invent a number from current leverage caps.
- **SHOULD HAVE:** Configuration can be changed only by a clearly authenticated vault/market authority, with events and bounds. Decide whether a config update affects existing positions immediately; conservative MVP is deterministic immediate application, announced by event.
- **DEFER:** Risk-level-dependent or market-volatility-dependent maintenance if that calculation is sourced from off-chain RiskState. Phase 4 risk state remains for new exposure and must not create ambiguous liquidation threshold changes.

## 14. Liquidation condition and model

For signed isolated equity `E` and maintenance requirement `M`, a position is liquidatable exactly when `E <= M`. Equality is liquidatable. `M` is nonnegative; `E <= 0` is unhealthy. Do not divide to form a margin ratio for eligibility; direct comparison avoids division/zero-notional issues. A ratio can be emitted for clients only when current notional is positive and with documented precision.

- **MUST HAVE:** Permissionless full liquidation for one unhealthy open position, using the same validated oracle account snapshot for PnL, notional, and eligibility.
- **MUST HAVE:** A healthy position cannot be liquidated; an unhealthy position transitions atomically to closed/zero size and notional; all position locked accounting is reconciled. Define whether remaining positive equity becomes user free collateral or is retained in isolated state pending settlement. Since Phase 5 tracks only a lock counter, this must be specified before coding.
- **SHOULD HAVE:** Initially avoid a liquidation reward. Permissionless keepers can demonstrate liveness without rewarding an attacker from user collateral. Add a capped reward only after bad-debt and authorization economics are tested.
- **DEFER:** Partial liquidation. It requires a target position size, post-reduction margin calculation, repeated-price/loop bounds, and reward/rounding choices; not necessary to prove eligibility and safe close.
- **MUST HAVE:** A second liquidation attempt on closed state fails. Owner close remains allowed regardless of RiskState freshness, but once PnL settlement exists it must also use a validated price and atomic accounting.

## 15. Bad debt

If realized/unrealized PnL is less than negative locked collateral, equity is negative and the loss exceeds that isolated collateral. No present account funds or protocol rule covers this deficit. Do not silently clamp the loss and release collateral as though it were solvent.

- **MUST HAVE:** Detect and expose `bad_debt = max(0, -E)` at liquidation/close. Do not debit other users' shares or reduce vault-wide deposits without an explicit, funded loss-sharing contract.
- **MUST HAVE for current MVP:** Choose an explicit limitation: restrict the demo to valuation/liquidation eligibility and do not claim profitable/losing PnL has been settled into withdrawable collateral. If settlement is implemented, ensure loss debit cannot exceed a funded isolated balance; unresolved excess becomes explicit bad-debt state and blocks unsafe withdrawal/settlement pending a policy.
- **DEFER:** Insurance fund, protocol-owned backstop, socialized losses, and external recapitalization.

## 16. RiskState integration

- Increase/add exposure → valid RiskState PDA, authority-authenticated state, exact nonce history, freshness, and effective leverage cap required (**MUST HAVE**, existing contract).
- Reduce exposure/owner close → must remain possible when RiskState is stale, Critical, or Active contagion (**MUST HAVE**). Price-aware settlement still requires a valid oracle; where closing is merely reduce-only without settlement, specify that distinction.
- Liquidate → requires valid position/config/oracle and `equity <= maintenance`; does not require RiskState to be fresh or non-Critical (**MUST HAVE**).
- Withdraw → remains bounded by user collateral/share and all locked/settlement liabilities (**MUST HAVE**); it is not an exit from an undercollateralized open position.
- RiskState can continue carrying risk level, contagion, and max leverage for new exposure. Do not add maintenance parameters there by default; a per-market configuration is a better owner for market-specific maintenance.

## 17. Off-chain engine and Velocity/Phoenix boundary

Off-chain stays responsible for OI, funding, liquidity, liquidation pressure, volatility, venue divergence, contagion, and ecosystem-level risk. It can publish the existing bounded `RiskState` policy summary; it must not be trusted to supply arbitrary PnL or override oracle validation.

- **MUST HAVE:** Core program remains venue-agnostic. Market config binds a protocol market identity to its permitted oracle feed and collateral/quote assumptions.
- **OPTIONAL:** `OracleProvider`-like module boundary is useful internally for parsing/normalizing the selected provider. A public Rust trait is unnecessary in BPF.
- **DEFER:** `PerpExecutor`, `LiquidationEngine` venue adapters, Velocity/Phoenix execution sync, funding settlement, and end-to-end transaction orchestration.
- **SHOULD HAVE:** Document exact mapping from off-chain canonical `indexPrice`/`markPrice` to the chosen on-chain feed. MVP should choose one authoritative valuation price type; do not mix index for one calculation and reserve/mark for another without a reviewed rule.

## 18. Account/PDA changes

| Account | Seeds/owner/authority | Fields and justification | Classification |
|---|---|---|---|
| `MarketConfig` | New PDA `[market_config, vault, market]`; program-owned; initialized/updated by a specified vault authority (possibly `Vault.authority`). | market key, expected provider program, oracle/feed identity, quote/collateral scale, supported exponent/price bounds, confidence/freshness bounds, maintenance bps, config version/bump. Needed to stop users supplying a wrong feed or arbitrary market. | **MUST HAVE** if market set is permissionless today; otherwise embed in an existing authoritative registry if one exists. |
| `Position` | Existing seeds `[position, vault, owner, market]`; program-owned. | Add normalized average entry price and explicit unit/schema version; realized PnL only if settlement is implemented. | **MUST HAVE** |
| `RiskState` | Existing `[risk_state, vault]`; risk-authority updates. | No oracle price, PnL, or maintenance fields required for MVP. | Preserve; no schema change **MUST HAVE** |
| `OracleConfig` separate account | Could be provider/feed specific, but duplicates MarketConfig mapping for single-provider MVP. | Avoid unless multiple markets share independently governed oracle settings or config space requires it. | **DEFER** |
| `InsuranceFund` | New PDA/token vault and authority. | No present need until funded bad-debt backstop is designed. | **DEFER** |
| `LiquidationState` | New PDA. | Eligibility is derived atomically per position; persistent queue/epoch state is unnecessary for permissionless full close. | **DEFER** |

If Position account versions change, include old/new layouts and migration/redeployment instructions. Never reuse existing PDAs while assuming accounts have new bytes.

## 19. Instruction design

- `initialize_market_config` / `update_market_config`: **MUST HAVE** if `MarketConfig` is introduced. Restrict signer to configured admin, bound every parameter, reject default keys/invalid identities, emit full config change. Governance/authority rotation must be specified.
- `increase_position`: **MUST HAVE modification** to take or derive base quantity and collateral, load `MarketConfig` and configured oracle, validate price, calculate quote exposure/initial margin, validate fresh RiskState, update weighted average entry and accounting atomically. Do not accept a separate caller-supplied notional that can contradict quantity × price.
- `reduce_position`: **MUST HAVE modification** to validate price if realizing PnL, calculate reduced quantity/PnL, update remaining exposure/entry/collateral and release/debit collateral atomically. If no settlement support, keep this as quantity reduction with carefully specified collateral release and no claim of realized PnL.
- `close_position`: **MUST HAVE modification** to apply documented oracle-based settlement and accounting, or explicitly retain Phase 5 accounting-only close as a non-PnL operation until settlement is designed. Do not release all locked collateral after a losing PnL without applying the loss.
- `liquidate_position`: **MUST HAVE** permissionless signer; position owner is not required to sign. Accounts bind vault, user account, market config, expected oracle, position PDA, clock; validates and fully closes only unhealthy position. Signer has no discretionary price input.
- `withdraw`: **MUST HAVE review** for locked and realized liabilities; unchanged policy bypass for RiskState does not mean bypassing collateral solvency constraints.
- No instruction should trust a caller-provided current price, PnL, margin ratio, or liquidation flag.

## 20. Error design

Add explicit errors with deterministic client meaning: `InvalidOracleAccount`, `WrongOracleOwner`, `WrongOracleFeed`, `InvalidOraclePrice`, `InvalidOracleConfidence`, `StaleOraclePrice`, `FutureOraclePrice`, `UnsupportedPriceExponent`, `PriceOutOfRange`, `InvalidMarketConfig`, `InvalidMarginConfig`, `InsufficientInitialMargin`, `PositionHealthy`, `PositionUnhealthy` (if needed for owner operation), `BadDebtDetected` (only where transaction must stop), and `InvalidPositionState/Version`. **MUST HAVE.** Continue using existing checked arithmetic/conversion errors or distinguish `PnlOverflow`/`MarginOverflow` if clearer; never collapse validation failure into success. Error additions are schema/client-visible and should be documented.

## 21. Event design

- `MarketConfigInitialized/Updated`: market, feed/provider, parameters, config version, authority (**MUST HAVE**).
- `PositionOpened/ Increased`: quantity, average entry, required/locked collateral, risk nonce, price publish time/config version (**MUST HAVE** additions for observability; do not expose unvalidated caller price).
- `PositionReduced/Closed`: quantity reduced, realized PnL, released/consumed collateral, resulting quantity/entry, price publish time (**MUST HAVE** if settlement is implemented).
- `PositionLiquidated`: owner, market, side, quantity closed, validated price, equity, maintenance, realized PnL, bad debt, collateral retained/released, keeper signer, publish time/config version (**MUST HAVE**).
- Avoid emitting confidential/user-sensitive data beyond already public account data. Events are observability, not state authority.

## 22. Arithmetic strategy

- **MUST HAVE:** No floating point. Normalize to explicit decimal scales; define quantity, price, collateral, PnL, and notional units in source comments and client docs.
- **MUST HAVE:** Use checked signed wide arithmetic for price difference and PnL; checked unsigned wide arithmetic for products and ceil-div margin. Validate domains before conversion.
- **MUST HAVE:** For required collateral/margin, round up; for profits, round down; for losses/fees/debits, round against the account paying. State each rule in helper docs/tests.
- **MUST HAVE:** Treat zero size/notional as invalid for open valuation; closed state must have size/notional/locked collateral zero and status Closed. For eligibility compare signed equity directly with maintenance, avoiding division by zero.
- **MUST HAVE:** Derive hard max quantity/price/exponent values from a range proof so all products, sums, and conversion fits are proven. If `i128` is insufficient for chosen scale, reduce supported range or use a reviewed multiword method; never rely on debug overflow behavior.
- **MUST HAVE:** All account mutations happen after validations/calculations; Solana transaction atomicity rolls back CPI and account writes on failure, but tests must still verify state unchanged.

## 23. Security threat model

| Threat | Required control | Class |
|---|---|---|
| Stale/future/zero/negative/extreme-confidence price | Freshness, sign, confidence, exponent, range checks before use | **MUST HAVE** |
| Wrong oracle owner/feed/market | Configured provider owner + feed ID + MarketConfig/PDA binding | **MUST HAVE** |
| Malformed account | Validate owner, discriminator/layout, data length, parser result | **MUST HAVE** |
| Caller-chosen price/PnL/liquidation flag | Never accept as trusted instruction args; parse configured oracle account | **MUST HAVE** |
| Race between submit and execution | Use execution-time transaction account snapshot and enforce publish-time freshness; no off-chain precheck is authoritative | **MUST HAVE** |
| Wrong owner, vault, market, fake Position PDA | Preserve seeds, `has_one`, owner signer on owner actions; validate config market/feed | **MUST HAVE** |
| Double liquidation/close | Require Open state; atomic state transition to Closed and zero values; second call fails | **MUST HAVE** |
| Liquidating healthy account | Program-computed signed equity/maintenance with same price snapshot; strict comparison rule | **MUST HAVE** |
| Reward manipulation / repeat partial liquidation | No MVP reward or partial liquidation | **DEFER** |
| Arithmetic overflow/underflow/precision truncation/divide by zero | checked wide arithmetic, domain bounds, explicit directional rounding, no ratio division for eligibility | **MUST HAVE** |
| Stale/malicious/wrong RiskState or policy bypass | Existing PDA, authority, nonce, timestamp, cap validation remains on increases; liquidation path does not consult it | **MUST HAVE** |
| Bad debt drains other users | Isolated collateral accounting, explicit debt result, no implicit share/vault debit | **MUST HAVE** |
| Config authority changes threshold/feed maliciously | Authority restriction, bounded params, update event/version; authority rotation and governance documented | **MUST HAVE** |

## 24. Testing strategy

All tests use LiteSVM and should construct provider-owned oracle accounts with valid/invalid data. Retain full Phase 1–5 regression tests.

- **Oracle — MUST HAVE:** valid feed; stale; future beyond skew; zero; negative; confidence negative/greater than price/ratio too high; wrong owner/program; wrong feed; malformed/truncated bytes; unsupported exponent; range overflow; market/feed mismatch; normalization and rounding at exponent boundaries.
- **PnL — MUST HAVE:** long profit/loss; short profit/loss; zero move; exact break-even; partial reduction; full close; average entry after adding; extreme movement; signed boundary/overflow; profit-down/loss-up rounding.
- **Margin — MUST HAVE:** initial collateral exactly required and one unit below; maintenance healthy/equal/below; zero equity; negative equity; zero/invalid notional; ceil rounding; max bounds.
- **Liquidation — MUST HAVE:** healthy cannot liquidate; exactly maintenance is liquidatable; below maintenance can liquidate; stale/wrong oracle blocks; position and aggregate locked accounting update; double liquidation fails; permissionless keeper succeeds; owner/keeper identity does not alter eligibility; owner cannot withdraw locked funds; transaction failure leaves all accounts unchanged.
- **RiskState — MUST HAVE:** stale/missing/wrong RiskState blocks increase; Critical/Active blocks increase; stale RiskState does not block valid liquidation, reduce, or close; liquidation still fails for healthy position even under Critical risk.
- **Bad debt — MUST HAVE:** loss equal collateral; loss exceeds collateral; no silent vault/share reduction; explicit bad debt outcome; withdrawal behavior with outstanding liabilities.
- **Regression — MUST HAVE:** initialize, shares, deposit/withdraw, authority rotation, update nonce/timestamps, leverage cap, increase/reduce/close accounting and all existing tests pass.

## 25. Invariants

- Open positions have positive quantity and a valid positive average entry; market/vault/owner identities match their PDA/config.
- Closed positions have `size == 0`, current/entry notional zero if stored, and `collateral_locked == 0`; status is Closed.
- `UserVaultAccount.locked_collateral` equals the sum of its positions' locked collateral (or a separately proven aggregate invariant); it never exceeds the account's collateral available under the chosen custody model.
- Withdrawable collateral never includes locked collateral or liabilities already reserved for negative realized PnL.
- A valid valuation always uses a configured feed with acceptable owner, identity, price, confidence, exponent, and freshness.
- Only a fresh authenticated RiskState can authorize new exposure; stale RiskState does not block reduce/close/liquidate.
- No healthy position can be liquidated; no unhealthy eligibility decision uses stale oracle data.
- All PnL/margin calculations are deterministic, checked, and use stated rounding; no overflow, underflow, or divide-by-zero is accepted.
- One transaction either fully updates Position and UserVaultAccount/collateral state or changes none of them.
- Vault shares represent deposit claims and do not change due to mark-to-market PnL.
- Negative equity/bad debt is explicit and cannot silently consume other users' share backing.

## 26. Implementation order

1. **MUST HAVE:** Resolve denomination, size/price scale, custody/settlement, bad-debt and migration decisions. Document a range proof and select the provider/feed type.
2. **MUST HAVE:** Add MarketConfig and provider parser/normalized validation; write LiteSVM oracle fixtures/tests first.
3. **MUST HAVE:** Implement checked price normalization and PnL helpers, then unit/property-style boundary cases.
4. **MUST HAVE:** Migrate Position and price-aware open/add/reduce/close accounting; verify atomicity and Phase 1–5 compatibility.
5. **MUST HAVE:** Implement isolated initial/maintenance margin helpers and liquidation eligibility.
6. **MUST HAVE:** Add permissionless full liquidation with events and bad-debt behavior.
7. **MUST HAVE:** Run all Anchor/LiteSVM regressions and review generated IDL/client changes and migration documentation.
8. **DEFER:** Partial liquidation, reward, insurance, funding, cross-margin, venue CPI/execution.

## 27. File-by-file change plan

| File | Planned work | Class |
|---|---|---|
| `src/state.rs` | Add MarketConfig; define Position unit/version and entry/settlement fields; preserve RiskState | **MUST HAVE** |
| `src/constants.rs` | Add PDA seed, fixed scales, hard bounds; set oracle freshness only after provider cadence decision | **MUST HAVE** |
| `src/errors.rs` | Add oracle/config/margin/liquidation/bad-debt errors | **MUST HAVE** |
| `src/math.rs` | Add normalization, signed PnL, weighted-entry, initial/maintenance margin, range-safe helpers | **MUST HAVE** |
| `src/oracle.rs` (new) | Provider account validation and normalized validated price; no caller-trusted values | **MUST HAVE** |
| `src/market_config.rs` or `instructions/market_config.rs` (new) | Initialize/update configuration and bound admin changes | **MUST HAVE** |
| `src/instructions/mod.rs` | Export config/liquidation instructions and modules | **MUST HAVE** |
| `src/instructions/increase_position.rs` | Load config/feed, validate price, compute entry notional/margin, enforce RiskState | **MUST HAVE** |
| `src/instructions/reduce_position.rs` | Price-aware quantity reduction and PnL/collateral settlement rules | **MUST HAVE** |
| `src/instructions/close_position.rs` | Safe settlement and close accounting | **MUST HAVE** |
| `src/instructions/liquidate_position.rs` (new) | Permissionless validated full liquidation | **MUST HAVE** |
| `src/instructions/withdraw.rs` | Check liabilities/free collateral under final equity/custody model | **MUST HAVE** |
| `src/lib.rs` | Expose config and liquidation entrypoints; generated IDL/client impact | **MUST HAVE** |
| `tests/test_oracle.rs` (new) | Oracle parsing, binding, freshness, confidence, precision | **MUST HAVE** |
| `tests/test_pnl_margin.rs` (new) | Formula, rounding, boundary, overflow, margin | **MUST HAVE** |
| `tests/test_liquidation.rs` (new) | Eligibility, keeper, state/accounting atomicity, RiskState independence, bad debt | **MUST HAVE** |
| Existing Rust tests | Update helpers/fixtures to declared units; preserve Phase 1–5 behavior | **MUST HAVE** |
| `docs/phase-6-implementation-plan.md` | Architecture decision/spec (this file) | Done; no code changes |

## 28. Phase 6A–6E breakdown

- **Phase 6A — Oracle boundary:** Provider spike; select feed type; market/feed binding; validation and freshness; mock fixtures. **MUST HAVE.** No PnL yet.
- **Phase 6B — PnL and valuation:** Define units, schema migration, entry/average entry, realized/unrealized helper and safe close/reduce semantics. **MUST HAVE**, conditional on explicit settlement/custody decision.
- **Phase 6C — Margin:** initial margin tied to RiskState cap; fixed bounded per-market maintenance; isolated equity and exact eligibility comparison. **MUST HAVE.**
- **Phase 6D — Liquidation:** permissionless full close, no reward, explicit bad-debt outcome, atomic accounting. **MUST HAVE** for recommended demonstration; if settlement remains unresolved, only implement valuation eligibility and clearly defer claims of actual liquidation/settlement.
- **Phase 6E — Integration:** Map off-chain canonical index/mark price and RiskState publication; no venue execution. Provider/data mapping documentation is **SHOULD HAVE**; Velocity/Phoenix transaction adapters and execution synchronization **DEFER**.

## 29. Hackathon MVP recommendation

Demonstrate the existing product differentiator: live off-chain multi-venue risk → authenticated, nonce-sequenced on-chain policy → a price-validated isolated position → deterministic margin/liquidation eligibility. Keep the demo bounded to one collateral denomination and one configured oracle feed per market. Use LiteSVM to show wrong/stale price rejection, RiskState gating increases, stale RiskState not preventing liquidation, and atomic full liquidation.

Do not represent the prototype as a complete perp exchange or claim gains/losses settle against real venue liquidity. If custody and PnL settlement cannot be completed and reviewed, the defensible MVP is price valuation + maintenance eligibility + a simulated/accounting liquidation with explicit limitations—not a live-collateral trading product. This product boundary is **MUST HAVE** for accurate demos; oracle-provider choice and one market config are **SHOULD HAVE**; exchange execution, insurance, rewards, and cross-margin are **DEFER**.

## 30. Phase 7 boundary

Phase 7 may evaluate funding, mark/index methodology, liquidation rewards, insurance/backstop design, partial liquidation, cross-position margin, venue execution adapters, and synchronization with Velocity/Phoenix. Each requires independent economic, custody, and adversarial review. None is implied by Phase 6 acceptance. **DEFER** all until Phase 6 price/PnL/margin and bad-debt invariants are proven.

## Decisions required before implementation

1. What exactly are `size`, `notional`, and collateral units, including quote/collateral conversion?
2. Which oracle program/feed and which price type (index, mark, or another explicitly selected source) are authoritative?
3. What provider cadence, staleness age, future skew, confidence limit, and max price/exponent bounds are supported?
4. Does this program only model positions or custody/settle losses and gains? Where is counterparty liquidity for gains?
5. What is the bad-debt state/withdrawal policy absent an insurance fund?
6. Will Phase 6 deploy under a new program/PDA namespace or migrate existing Position accounts?
7. Which authority may configure markets/feed/maintenance parameters and how is it governed/rotated?

These are implementation gates, not details to guess in code.

## Implementation decisions and MVP boundary

The implementation uses the official `pyth-solana-receiver-sdk` 2.0.0 with the repository's Anchor 1.1.2 / Solana 3.x toolchain. The receiver SDK owns `PriceUpdateV2` account decoding and the program additionally requires its `Full` verification level, the configured account key and feed ID, positive price, supported exponent, confidence bounds, and timestamp freshness. This SDK/toolchain combination compiled for host and SBF. The current production receiver program ID is supplied by the SDK; tests create serialized SDK `PriceUpdateV2` accounts owned by that ID in LiteSVM and do not represent a live oracle update flow.

The demo uses six decimal places for base quantity, normalized price, and quote collateral atoms. Market configuration requires a six-decimal collateral mint and assumes the collateral is USD-pegged and denominated like the Pyth USD quote. The program does not verify that peg. Oracle age is authority-configurable from 0 through 30 seconds; the 30-second hard ceiling follows the official SDK's sample freshness value. Future timestamps are rejected (zero future skew). Confidence tolerance is authority-configurable from 0 through 10,000 bps, with confidence required to be strictly below price. Each market sets its own maintenance margin in 1–10,000 bps; this is an authority decision, not a dynamically calculated off-chain risk metric.

The existing `max_leverage_x100` encoding is retained: 300 represents 3.00x. Therefore initial margin is `ceil(notional * 100 / effective_leverage_x100)`. A price/size notional supplied by the caller must exactly match the validated oracle-derived notional.

PnL, equity, margin, and bad debt are diagnostic. No PnL is minted, transferred, charged to shares, or deducted from vault deposits. Reduce/close/liquidate use a validated price; when their affected slice has negative diagnostic PnL, its existing collateral is moved to `UserVaultAccount.settlement_reserved`. That reserve is not withdrawable and there is no release path in this MVP. Liquidation closes the position, reports any deficit below isolated collateral as bad debt, and quarantines its remaining collateral. This deliberately favors solvency over recoverability until funded settlement is designed.

The `Position` and `UserVaultAccount` layouts changed while the program ID remains the same. No migration instruction is implemented. Do not upgrade a deployment containing Phase 5 accounts with this schema; use fresh state or implement and review an explicit migration before deployment. No Devnet deployment was performed.
