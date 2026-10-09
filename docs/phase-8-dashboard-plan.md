# SentinelX — Frontend Implementation Plan

**Status: Planning only.** This document describes a proposed implementation. It does not implement code, deploy the Solana program, migrate accounts, or authorize changes to Rust instructions, account layouts, risk calculations, publisher behavior, or protocol behavior.

The plan is organized into exactly seven implementation phases. The frontend is an observability and user-transaction interface around the existing system; it is not another risk engine or publisher.

## Existing Project Context

### Current frontend and workspace

There is no frontend in the repository today. The repository is a Bun workspace using TypeScript and Vitest. Its workspace globs already cover a future `apps/dashboard` and `packages/*`; tests are organized in dedicated `tests/` folders. No router is needed for the initial single-page dashboard. Use React, Vite, TypeScript, existing workspace tooling, and native CSS. ([Vite guide](https://vite.dev/guide/))

### Existing risk and chain architecture

```text
Velocity + Phoenix
        ↓
Canonical MarketState
        ↓
Existing Risk Engine
        ↓
Cross-Venue Risk + Contagion
        ↓
Policy Mapper
        ↓
Separate Risk Publisher
        ↓
Solana RiskState
        ↓
On-chain Position Risk Gate
        ↓
User Wallet Transaction
```

The existing API exposes health, market, per-market risk, ecosystem risk, and contagion endpoints. It does not currently expose one coherent dashboard snapshot, the policy mapper result, publisher history, on-chain state, positions, or transaction history. Its `/health` response only confirms that the process responds. The publisher currently emits logs but does not persist or serve them. The API supports Velocity and Phoenix; its Velocity market RPC defaults to mainnet-beta.

Existing canonical `MarketState`, `MarketRisk`, cross-venue, and contagion types should be reused. Null metrics mean unavailable, not zero. The current API gathers both ecosystem venues together, so the dashboard snapshot should collect each once and represent partial venue failures independently.

The generated Anchor IDL and type exist locally under ignored `anchor/risk_vault/target/` output and are not checked in. Use the generated IDL as the account and instruction schema source; do not hand-maintain account layouts. Verify that the generated client works with the selected Solana Kit stack before relying on it. ([Anchor IDL](https://www.anchor-lang.com/docs/basics/idl), [Anchor configuration and Codama](https://www.anchor-lang.com/docs/references/anchor-toml))

The program is not currently verified as deployed to a cluster. `Anchor.toml` naming devnet is not deployment evidence. All LIVE transaction controls remain disabled until the deployment and publisher readiness conditions in Phase 3 and Phase 4 pass.

### Non-negotiable responsibility boundaries

- **Backend and existing packages:** collect market state and calculate risk, cross-venue divergence, contagion, and policy.
- **Risk Publisher:** read current `RiskState`, derive the next nonce, sign with its configured risk authority, submit, confirm, and verify a policy update.
- **Solana program:** remain authoritative for instruction checks and policy enforcement.
- **Browser wallet:** authorize only explicitly reviewed user actions; it never holds the publisher authority.
- **Dashboard:** observe and present the system and construct only allowlisted user transactions.

The frontend must not calculate authoritative risk, publish `RiskState`, store private keys, bypass or weaken contract checks, construct arbitrary instructions, or imply that its UI is the security boundary. The program remains authoritative for RiskState freshness and nonce, risk level and contagion, leverage, exposure, collateral, oracle and margin checks, liquidation eligibility, account ownership, and arithmetic safety.

### Shared architecture

**LIVE:**

```text
Velocity/Phoenix → existing collectors/adapters → Canonical MarketState
                                                ↓
                                      existing risk packages
                                                ↓
                               cross-venue risk + contagion
                                                ↓
                                           policy mapper
                                          ↙            ↘
                          Dashboard Snapshot API    Risk Publisher
                                  ↓                       ↓
                           React dashboard       authenticated update
                                                        ↓
                                              Solana RiskState PDA
                                                        ↓
Browser wallet → user instruction → Solana program → accepted/rejected
```

**DEMO:**

```text
Deterministic fixture MarketStates → same existing risk packages
                                   → same cross-venue/contagion logic
                                   → same policy mapper
                                   → demo snapshot API → dashboard
```

Only the input source changes. LIVE and DEMO use the same backend risk and policy calculations. Demo fixtures never reach the publisher or chain-write path.

---

## Phase 1 — Frontend Foundation

### Objectives

- Create a maintainable, responsive React/Vite/TypeScript app at `apps/dashboard`.
- Integrate it into the existing Bun workspace and scripts.
- Establish the basic component structure, global styles, accessible status primitives, and explicit LIVE/DEMO selection state.
- Keep the app intentionally small; do not introduce a general state-management or routing framework without a demonstrated need.

### Architecture and data flow

```text
Browser → React app shell → page/components
                         ↘ API client boundary (introduced, not yet live-connected)
```

The initial source selection is presentation state only. It must never silently switch from LIVE to DEMO after a request failure. Render loading, error, stale, unavailable, and empty states as distinct states.

### Files and components

Create:

- `apps/dashboard/package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`
- `apps/dashboard/src/main.tsx`, `App.tsx`, `styles.css`
- Initial component shells: `SystemHeader`, `ProtocolFlow`, `EcosystemRiskSummary`, `VenueRiskGrid`, `CrossVenuePanel`, `RiskPolicy`, `OnChainRiskState`, `WalletConnect`, `UserTransactionPanel`, `DemoControls`, and `EventTimeline`
- `apps/dashboard/tests/Dashboard.test.tsx`

Modify:

- Root `package.json` to add dashboard dev/build/typecheck scripts.
- Root `tsconfig.json` only if needed; otherwise use the dashboard's own strict TSX config.
- `README.md` with app startup and configuration guidance.

### Dependencies

- React, React DOM, Vite, `@vitejs/plugin-react`, TypeScript, and React type packages.
- Reuse Bun workspace and Vitest. Add `@testing-library/react` and `jsdom` when UI rendering tests are introduced.
- Native CSS; no chart, router, Redux, query client, or component framework initially.

### Implementation order

1. Add the workspace app and scripts.
2. Set strict TSX settings and the Vite API proxy configuration.
3. Create semantic page regions and reusable status/loading/error components.
4. Add responsive layout and keyboard-visible focus states.
5. Document local startup and LIVE/DEMO labels.

### Testing requirements

- App entry renders and dashboard shell mounts.
- LIVE and DEMO have visually and accessibly distinct badges.
- Loading, error, empty, and unavailable states are distinguishable.
- Layout responds to narrow and wide viewports; keyboard navigation and visible focus work.

### Security considerations

- Do not put secrets in `VITE_` environment variables; browser-exposed values are public.
- Do not add publisher imports, wallet signers, or transaction construction in this phase.
- A LIVE badge at this stage means only that LIVE is selected; it must not claim that feeds, chain, or enforcement are healthy.

### Acceptance criteria

- Dashboard starts through the workspace command and passes TypeScript checking.
- Responsive shell and core status states are in place.
- LIVE and DEMO source selection is explicit and there is no automatic fallback.

### Explicit non-goals

- No risk calculations, snapshot API, chain reads, wallet connection, transaction signing, publisher integration, historical charts, or protocol changes.

---

## Phase 2 — Live Risk Dashboard + Snapshot API

### Objectives

- Add one coherent API response for a selected symbol.
- Use existing collectors/adapters and risk packages without creating frontend risk logic or a second backend risk engine.
- Present current venue, ecosystem, cross-venue, contagion, and policy outputs with clear freshness and partial-failure states.
- Preserve the existing backend collection cadence independently of browser polling.

### Architecture and data flow

```text
Existing Velocity/Phoenix collection → canonical MarketState values
                                     → existing risk/cross-venue/contagion/policy functions
                                     → GET /dashboard/snapshot?symbol=SOL-PERP
                                     → validated frontend DTO → dashboard
```

The API collects each venue once for a coherent snapshot. If one required venue is missing, stale, or invalid, retain the available venue's card but report combined risk, contagion, and policy as unavailable. Never translate missing inputs into low risk. Poll approximately every five seconds without overlapping requests; browser polling reads snapshots and does not trigger or own backend risk collection.

### Files and components

Create:

- `packages/api-contracts/package.json`
- `packages/api-contracts/src/dashboard.ts` for Zod schemas and shared DTO types
- `packages/api-contracts/tests/dashboard.test.ts`
- `apps/api/src/dashboard-service.ts`
- `apps/api/tests/dashboard.test.ts`
- `apps/dashboard/src/api/client.ts`
- `apps/dashboard/src/hooks/useDashboardSnapshot.ts`
- `apps/dashboard/tests/api-client.test.ts`

Modify:

- `apps/api/src/app.ts` to register the snapshot route.
- `apps/api/src/market-service.ts` only as needed to collect both venues once and preserve independent status.
- `apps/api/package.json` for internal API-contract dependency.

Wire existing dashboard components to the validated snapshot: `SystemHeader`, `EcosystemRiskSummary`, `VenueRiskGrid`, `CrossVenuePanel`, and off-chain `RiskPolicy` view.

### Dependencies

- Zod for response validation and shared API contracts.
- Existing Express, TypeScript, Bun, and Vitest dependencies.
- Native `fetch` and an abortable bounded polling hook; no WebSockets or query library.

### Implementation order

1. Define and validate the snapshot contract, including source, timestamp, per-venue status, nullable metrics, and policy availability.
2. Implement snapshot assembly using current adapters and calculation functions.
3. Add route-level behavior and independent venue failure reporting.
4. Add typed frontend client, timeouts/abort, non-overlapping five-second polling, and stale age.
5. Connect the live dashboard cards and communicate missing values as `N/A` rather than zero.

### Testing requirements

- Valid, malformed, nullable, zero, stale, and unavailable response contracts.
- One collection per venue per snapshot; independent partial failure; both unavailable; timeout and API error envelopes.
- Verify risk, cross-venue, contagion, and policy are calculated by existing functions and not reimplemented in the UI.
- Polling does not overlap and stops/aborts on unmount.
- Stale retained data stays visibly stale; incomplete inputs cannot appear as low risk.

### Security considerations

- Validate server output on the client; treat API values as untrusted.
- Do not accept caller-supplied risk scores or policy values as authoritative inputs.
- Keep source mode discriminated as `LIVE`; do not auto-load DEMO after LIVE failure.
- `/health` is process-only and cannot alone produce an operational/healthy status.

### Acceptance criteria

- LIVE dashboard accurately reflects backend outputs and their freshness.
- It displays Velocity and Phoenix risk/market values, cross-venue values, contagion, and policy only when the required inputs are valid.
- Partial failure, null values, zero values, stale observations, and full failures are distinct.

### Explicit non-goals

- No dashboard-side scoring, new risk algorithm, persistent history, publisher changes, on-chain writes, or transaction controls.

---

## Phase 3 — Risk Policy + On-Chain State

### Objectives

- Show off-chain calculated policy beside independently read, actual on-chain `RiskState`.
- Build a verified read-only Solana account path from the existing Anchor IDL.
- Make the distinction explicit: **OFF-CHAIN POLICY is not on-chain authority**. Only the Solana program uses the on-chain state for enforcement.
- Establish deployment/readiness facts needed before enabling transactions in Phase 4.

### Architecture and data flow

```text
Dashboard Snapshot API → OFF-CHAIN policy panel
Selected Solana RPC → Kit read client → validate program owner/PDA/discriminator/layout
                                      → ON-CHAIN Vault/RiskState/user account panel
```

Read `Vault`, `RiskState`, and where relevant the connected user's `UserVaultAccount` and `Position`, plus selected `MarketConfig`. Validate cluster, program ID, configured vault, PDA, account owner, discriminator, account layout, market and oracle configuration before displaying decoded values. Read-only display does not require wallet connection. Keep off-chain policy and chain state separate, with mismatch, stale, unavailable, not-configured, and not-deployed states.

The browser must not infer a successful publisher event from calculated policy. A policy is shown as published only after a fresh, validated on-chain `RiskState` read reflects it. Publisher history/signature is not available unless a real verified event source is later added.

### Files and components

Create:

- `apps/dashboard/src/solana/client.ts` for explicitly selected cluster-scoped Kit RPC reads.
- `apps/dashboard/src/components/LiveReadiness.tsx`
- `packages/risk-vault-client/package.json`
- Generated IDL under `packages/risk-vault-client/idl/risk_vault.json` and generated account client under `src/`.
- `packages/risk-vault-client/tests/` for PDA/account decoding tests.

Modify:

- `OnChainRiskState.tsx`, `RiskPolicy.tsx`, `ProtocolFlow.tsx`, and `SystemHeader.tsx` to show chain/RPC/freshness and source distinctions.
- Anchor IDL output configuration or a generation script only as needed to produce a reproducible client from `anchor/risk_vault/target/`.

### Dependencies

- Solana Kit RPC client plugins and a Codama-generated client compatible with this Anchor IDL.
- The selected Solana frontend stack uses Wallet Standard and React Kit bindings where needed. ([Solana frontend docs](https://solana.com/docs/frontend), [Kit client](https://solana.com/docs/frontend/client))
- Compatibility gate: prove generated client and pinned Anchor IDL/toolchain compatibility first. If an adapter is needed, isolate conversions there; do not spread web3.js v1 types through the dashboard. The existing publisher remains on its own current stack.

### Implementation order

1. Generate and inspect the current IDL/client; establish reproducible generation and program address verification.
2. Configure explicit dashboard vault RPC/cluster independently from the API's market-data `SOLANA_RPC_URL`.
3. Implement read-only account fetch, PDA derivation, and validation.
4. Build separate off-chain/chain policy views, freshness, mismatch, and readiness states.
5. Document every unverified deployment condition and keep wallet controls unavailable.

### Testing requirements

- Correct cluster/program/PDA; owner, discriminator, layout, unsupported layout and malformed account tests.
- Unconfigured RPC, wrong cluster, stale state and mismatched policy display.
- Verify the calculated policy cannot be presented as published absent matching chain state.
- No live cluster is required for unit/UI tests; use deterministic account fixtures and mocked RPC.

### Security considerations

- Read-only account data remains untrusted until all checks pass.
- No private key or publisher authority exists in the browser.
- Pyth data may be displayed as account/config context, but the frontend must not claim authoritative client-side liquidation or settlement results.
- RPC provider credentials cannot appear in `VITE_` config. Use public RPC or a server-side proxy for credentialed endpoints.

### Acceptance criteria

- Dashboard independently shows live off-chain policy and actual verified on-chain `RiskState`.
- On-chain panel reports actual cluster, vault, nonce, level, cap, timestamps, and freshness when available.
- Mismatch, stale, unavailable, not configured, and not deployed are clearly distinct.
- Transactions remain disabled until all conditions below are verified.

### LIVE deployment/readiness prerequisites

Before any wallet action is enabled, verify: deployed program and correct program ID; selected cluster and reachable RPC; vault address and derived `RiskState` PDA; collateral mint; selected `MarketConfig`; configured oracle and required Pyth accounts; account layouts match the deployed program; wallet can read required program accounts; publisher authority is configured; and the existing publisher can successfully update, confirm, and verify `RiskState`. Until every check passes, show **LIVE TRANSACTIONS NOT CONFIGURED**. Never silently fall back to DEMO.

### Explicit non-goals

- No publisher control from the dashboard, no RiskState write, no account migration, no program deployment, and no new risk authority.

---

## Phase 4 — Wallet + Real Transactions

### Objectives

- Add optional browser wallet extension connection through Wallet Standard.
- Permit only explicitly reviewed and user-authorized instructions supported by the deployed program.
- Implement the real transaction lifecycle: account checks, instruction construction, simulation, transaction review, wallet approval, submit, confirm, and post-state reread.
- Keep the publisher wholly separate from user transaction authorization.

### Architecture and data flow

```text
User action → validate selected cluster/program/accounts → allowlisted generated instruction
           → simulate → display transaction summary → wallet approval
           → RPC submit → confirmation/status → reread affected accounts → update UI
```

The Wallet Standard extension (for example, a compatible Phantom/Solflare wallet) is responsible only for user authorization. Connecting never requests a transaction signature. Wallet account changes must update displayed wallet identity and invalidate/recheck any prepared transaction.

Initially allow only `increase_position`, `reduce_position`, and `close_position`. Deposit/withdraw may be included only if explicitly approved in scope and verified against actual program semantics and the Phase 6 valuation-only settlement boundary. Never expose `update_risk_state`, risk-authority rotation, market configuration, publisher operations, or arbitrary instruction construction.

### Files and components

Create:

- `apps/dashboard/src/solana/wallet.tsx` for Wallet Standard discovery and React signer context.
- `apps/dashboard/src/solana/transactions.ts` for narrow allowlisted instruction construction, validation, simulation and lifecycle.
- `apps/dashboard/src/components/WalletConnect.tsx`
- `apps/dashboard/src/components/UserTransactionPanel.tsx`
- `apps/dashboard/tests/wallet.test.tsx` and `apps/dashboard/tests/transactions.test.ts`

Modify:

- `apps/dashboard/src/solana/client.ts` to support Kit transaction simulation/submission and confirmation after the Phase 3 compatibility gate.
- `SystemHeader.tsx`, `LiveReadiness.tsx`, `OnChainRiskState.tsx`, and `App.tsx` for connection, selected cluster and action gating.
- Generated client package only through reproducible IDL generation, not manual layout edits.

### Dependencies

- Wallet Standard wallet plugin and React bindings from the Solana Kit frontend stack; Kit RPC plugin; generated Codama client if compatibility is validated.
- Do not add legacy `@solana/wallet-adapter-*` packages unless compatibility testing proves a concrete requirement. Do not migrate the separate publisher's web3.js v1 stack.

### Implementation order

1. Add wallet discovery/connect/disconnect and account-change handling, without signatures on connect.
2. Enforce all Phase 3 readiness gates before enabling actions.
3. Build only the allowlisted typed instructions from validated state.
4. Fetch fresh required accounts/blockhash, validate cluster/program/PDA/owners/layout, and simulate.
5. Show an explicit transaction review, then request wallet approval only after the user submits that review.
6. Submit and distinguish pending, confirmed success, and confirmed program failure.
7. Reread `UserVaultAccount`, `Position`, `Vault`, and `RiskState` as applicable; display actual post-state.

The transaction review shows action, market, side, size, collateral, requested leverage, current on-chain `RiskState`, max allowed leverage, cluster, program ID, fee payer, and estimated fee.

### Testing requirements

- Wallet connect/disconnect, account changes, multiple wallets when supported, and no signature prompt during connection.
- Correct program ID, cluster, PDA, account set and allowlisted instruction construction.
- Simulation success, policy rejection, invalid account, stale `RiskState`, insufficient collateral and oracle/account failure.
- Wallet rejection, RPC submission failure, pending, confirmation success, and confirmed program failure are distinct.
- Confirmed transaction triggers account reread; UI position and account state match reread data.
- Failed simulation is not submitted by default. Actual rejection errors are decoded only from actual simulation or confirmed transaction results.

### Security considerations

- Never collect, persist, or transmit wallet private keys. A wallet connection alone is not transaction consent.
- Require a clear review-and-submit action for every transaction; never sign on page load, polling, or scenario selection.
- Never construct arbitrary instructions or expose publisher/admin actions. The contract, not the UI, is the security boundary.
- In DEMO, disable wallet actions and ensure there is no instruction construction, signing, or RPC-send path.

### Acceptance criteria

- A compatible connected wallet can sign a real user instruction only after deployment readiness is verified.
- User sees the action and network before wallet approval; actual RPC signature/status is shown only when returned.
- Confirmed state is displayed only after actual confirmation and account reread.
- All instruction paths are allowlisted and DEMO cannot reach them.

### Explicit non-goals

- No publisher signing or update path, admin actions, arbitrary transaction builder, automatic fund movement, automatic liquidation, or frontend bypass of contract rules.

---

## Phase 5 — Live Risk Enforcement Demo

### Objectives

- Make the primary hackathon story demonstrate SentinelX's real value proposition: continuous off-chain risk monitoring, authenticated publisher updates, on-chain enforcement of subsequent exposure, and a valid risk-reducing exit.
- Show only actual policy, account state, transaction outcomes, signatures, and program errors.
- Keep calculation, publication, enforcement, and wallet authorization visibly separate.

### Architecture and data flow

```text
Velocity + Phoenix → existing risk engine → HIGH policy / 1x
                    → Risk Publisher → authenticated RiskState update
                    → dashboard verifies HIGH / 1x on-chain
User wallet → requests 2x increase → actual program checks RiskState → rejects
User wallet → reduce/close → actual program → confirms if program rules permit
```

The browser observes the existing collection and risk loop; it neither triggers it nor computes risk. The publisher independently reads current on-chain `RiskState`, derives the next nonce, signs with its configured authority, submits, confirms, and verifies the update. The dashboard may claim the policy is on-chain only after independently reading and validating the updated `RiskState`. Publisher transaction history/signatures are not invented; the publisher's current one-shot logs are not served by the API.

### Live demo sequence

This is the centerpiece 3–5 minute presentation flow and is possible only after every Phase 3 deployment precondition and Phase 4 transaction path has been verified.

1. Connect wallet. Show LIVE, selected cluster, program ID, vault, actual RiskState status and wallet public key. Connection requests no signature.
2. Show actual LOW / 3x off-chain policy and matching verified on-chain RiskState, including freshness.
3. Establish a 2x position: deposit first only if separately in scope; review and simulate the user instruction; receive explicit wallet approval; submit; confirm; and reread the actual position/account state. Show success only if the transaction succeeds.
4. Keep the position open while actual live inputs worsen (such as liquidity, OI, funding, liquidation pressure or venue divergence), and let the existing risk engine calculate HIGH / 1x. Do not manipulate production feeds or fabricate deterioration.
5. Let the existing publisher publish the policy. Show HIGH / 1x as on-chain only after rereading and validating the changed `RiskState` and nonce.
6. Attempt another 2x increase. Validate and simulate it. If simulation returns a decodable program policy error, report **Simulation would reject — transaction not sent** and show the actual error. If an actual transaction failure is demonstrated instead, it requires explicit review and wallet approval and must be reported as a confirmed program failure. Never call a wallet cancellation or RPC failure a risk rejection.
7. Reduce or close the existing position using the deployed program's valid risk-reducing instruction path. Confirm and reread. Demonstrate that elevated/stale risk does not block a valid exit only if the actual program accepts the transaction under its current rules.
8. Explain: SentinelX continuously monitors market risk off-chain, publishes an authenticated policy on-chain, and lets the Solana program enforce it against subsequent user exposure while preserving the tested reduce/close path.

If the presentation's live market does not deteriorate, show the honest current state and describe the flow; do not force a false live transition. For repeatable rehearsal, a localnet/devnet setup may use explicitly labelled controlled feed fixtures only when they travel through the existing risk pipeline and publisher and the user transaction still executes against the real program on that test cluster.

### Files and components

Create or complete:

- `apps/dashboard/src/components/LiveReadiness.tsx` for market, policy, publisher, chain and wallet readiness.
- `apps/dashboard/tests/live-demo-flow.test.tsx` for controlled end-to-end state transitions and transaction status rendering.
- `apps/dashboard/src/components/ProtocolFlow.tsx`, `RiskPolicy.tsx`, `OnChainRiskState.tsx`, `UserTransactionPanel.tsx`, and `EventTimeline.tsx` to distinguish calculation, publication, actual chain state, user action, and observed transaction result.

Modify the snapshot contract only to expose actual source/freshness/readiness information that can be supported by existing services. Do not add publisher history or start a new publisher service as a frontend prerequisite.

### Dependencies

- Phase 2 snapshot API, Phase 3 verified chain reader and Phase 4 wallet transaction lifecycle.
- Existing publisher and Solana program; no new backend infrastructure.
- Controlled RPC/program fixtures for automated tests, and verified deployed cluster for a real manual rehearsal.

### Implementation order

1. Expose separate status/freshness for market input, calculated policy, verified on-chain RiskState, and wallet readiness.
2. Add UI states for policy transition and independently verified chain update; do not imply causality or publisher transaction history beyond evidence.
3. Exercise LOW/3x and actual 2x position setup through a verified user transaction.
4. Rehearse real deterioration through existing collection/calculation and publisher paths.
5. Verify the 2x increase rejection via actual program simulation/error and verify actual reduce/close confirmation and post-state.
6. Document a presentation runbook that distinguishes a genuine live sequence from any controlled test-cluster rehearsal.

### Testing requirements

- Controlled integration sequence: LOW/3x → position opened → deteriorating fixture inputs through existing calculators → HIGH/1x policy → publisher update → independently verified HIGH/1x RiskState → 2x increase simulation rejected → reduce/close confirmed → position reread.
- Verify the dashboard never invokes publisher methods, constructs `update_risk_state`, or displays calculated policy as published without chain verification.
- Verify each simulation rejection, wallet cancellation, RPC failure, pending result, confirmed success and confirmed program failure has accurate wording.
- End-to-end live rehearsal requires actual deployment; automated tests use controlled RPC/program fixtures and do not claim to prove deployment.

### Security considerations

- Do not use unsafe production feed manipulation to force a presentation scenario.
- A simulation rejection is not a submitted transaction or confirmed on-chain failure.
- Reduce/close availability depends on actual deployed program rules; do not promise an exit path without verifying those rules.
- Do not display fake signatures, publisher confirmations, nonce progression, positions, or on-chain state.
- Keep the Phase 6 valuation-only boundary: unrealized PnL is not settled into user shares, vault deposits, withdrawable collateral, or another user's balance. Do not show positive collateral manufactured from unrealized profit; bad debt remains diagnostic only.

### Acceptance criteria

- When deployment and publisher prerequisites pass, the live demo can show actual LOW / 3x, a real 2x position, genuine risk deterioration, a publisher-verified HIGH / 1x RiskState, an actual program rejection for another 2x increase (by simulation or confirmed failure, accurately labelled), and confirmed reduce/close with an account reread if program semantics allow.
- Off-chain policy, publisher readiness, and on-chain authority are distinct in the UI.
- The dashboard never claims the frontend itself enforced policy.

### Explicit non-goals

- No new risk engine, publisher, scoring method, production feed manipulation, automatic liquidation, automatic collateral movement, or PnL settlement.

---

## Phase 6 — Demo Mode

### Objectives

- Provide a deterministic fallback presentation and rehearsal mode when live deployment is unavailable.
- Demonstrate the real risk pipeline with plausible fixtures, the same schemas and same existing calculations, without pretending that the market or chain is live.

### Architecture and data flow

```text
Named demo fixtures → canonical MarketState → same risk packages
                    → same cross-venue and contagion calculations
                    → same policy mapper → demo snapshot → dashboard
```

Add an opt-in endpoint such as `GET /demo/dashboard/snapshot?scenario=LOW`, disabled by default and rejected in production. Demo API and UI paths must not call the publisher or Solana write methods. A discriminated `DEMO` source field prevents mixed sources. Source switching is explicit; a failed LIVE request never changes to DEMO automatically.

### Scenarios

Define plausible Velocity/Phoenix `MarketState` fixture pairs using current schemas and existing fixtures. Do not add schema fields, hardcode a final score, or choose absurd values. These are calibration targets, not forced outputs:

| Scenario | Fixture characteristics | Target calculated result |
|---|---|---|
| LOW | Healthy liquidity, normal funding, moderate OI, low liquidation pressure and low venue divergence | LOW policy, normally 3x; contagion NONE or ISOLATED |
| MEDIUM | Increased OI concentration, worsening funding, some liquidity degradation, moderate liquidations/divergence | MEDIUM policy, normally 2x |
| HIGH | High OI, elevated funding, reduced liquidity, increased liquidation pressure and significant divergence | HIGH policy, normally 1x; calibrate DEVELOPING contagion |
| CRITICAL | Severe liquidity deterioration, extreme funding, high liquidation pressure and major divergence | CRITICAL policy, 0x; calibrate ACTIVE contagion |

Scenario details must derive claims from fixture fields and actual calculated results. Where metrics are null, show unavailable or omit the claim. Stable-output determinism checks exclude wall-clock timestamps or inject a test clock.

### Files and components

Create:

- `apps/api/src/demo/scenarios.ts` and `apps/api/src/demo/demo-service.ts`
- `apps/api/tests/demo-service.test.ts`
- `apps/dashboard/src/components/DemoControls.tsx` and `DemoScenarioDetails.tsx`
- `apps/dashboard/tests/demo-controls.test.tsx`

Modify:

- `apps/api/src/app.ts` for opt-in demo route and production gating.
- Shared dashboard snapshot contract to include the explicit source discriminator.
- Dashboard source switch and demo status labels.

### Dependencies

- Existing risk packages, `MarketStateSchema`, shared API contracts and Zod.
- No additional simulation backend, database, publisher or blockchain dependency.

### Implementation order

1. Create and schema-validate plausible fixture pairs.
2. Route them through the same snapshot assembly and real calculation functions as LIVE.
3. Calibrate scenario characteristics against observed calculated level/cap; adjust only input fixtures, never force final output.
4. Add explicit scenario selection and fixture-derived explanation.
5. Isolate demo path from live feeds, publisher, wallet signing and RPC writes.

### Testing requirements

- All fixtures pass the current `MarketStateSchema`.
- Full fixture → market risk → cross-venue risk → contagion → policy mapper path.
- Verify intended LOW/MEDIUM/HIGH/CRITICAL levels and policy caps from mapper outputs without hardcoding scores.
- Determinism of risk-relevant values.
- No live venue calls, publisher calls, wallet invocation, signing, RPC writes, fake nonce progression or fake confirmation.
- Demo source switches explicitly; no live-to-demo fallback or silent data mixing.

### Security considerations

- Show `DEMO MODE` and `ON-CHAIN ENFORCEMENT: NOT ACTIVE` persistently.
- Show `DEMO POLICY` and `ON-CHAIN RISKSTATE: NOT PUBLISHED — DEMO` separately.
- Disable transaction controls and ensure no signing/write call path can be reached from DEMO.
- Never show fake signatures, fake confirmations, fake RiskState updates, fake liquidation, or fake on-chain enforcement.
- Hypothetical leverage comparison is labelled `ILLUSTRATIVE` or `Policy Simulation`; it is not a Solana program execution or blockchain rejection.

### Acceptance criteria

- LOW/MEDIUM/HIGH/CRITICAL demo scenarios pass through the exact existing schemas and risk/policy functions.
- Demo mode is visually unmistakable, fully deterministic for risk outputs, and cannot write to chain or invoke publisher/wallet code.
- Demo details report only facts supported by fixture inputs and calculated results.

### Explicit non-goals

- No demo trading, wallet connection, signing, RPC writes, publisher invocation, fake market history, or simulated claim of on-chain enforcement.

---

## Phase 7 — Testing + Security + Final Polish

### Objectives

- Validate the complete dashboard experience, including live data, chain reads, wallet lifecycle, transaction states, and the main live/demo narratives.
- Complete security review of client boundaries and produce clear, accessible, honest UI copy.
- Keep the Rust program, existing risk calculations, publisher logic, and account layouts unchanged.

### Architecture and data flow

```text
Existing backend/API → validated LIVE snapshot → frontend observability
Selected RPC → validated accounts → wallet-approved transaction lifecycle
DEMO fixtures → same risk/policy path → isolated presentation-only scenario
```

The frontend remains an observability and user transaction interface. Backend calculates risk; publisher publishes policy; program enforces; wallet authorizes; dashboard observes and provides user transaction controls.

### Files and components

Create or complete dedicated test directories:

- `apps/dashboard/tests/`: dashboard, API client, wallet, transactions, demo controls, live demo flow, and accessibility/state tests.
- `apps/api/tests/`: dashboard snapshot, partial failures, demo gating, and demo calculation tests.
- `packages/api-contracts/tests/`: snapshot and status variants.
- `packages/risk-vault-client/tests/`: PDA, account decoding and generated client behavior.

Update:

- `README.md` with startup, environment, LIVE readiness, DEMO boundaries, supported wallet actions, and transaction/rejection state wording.
- Dashboard styles/components for responsive layout, keyboard focus, contrast, reduced motion, loading/error copy, and accessible risk labels.

### Dependencies

- Existing Vitest and Bun test setup.
- `@testing-library/react` and `jsdom` for rendered UI tests; add only what the tests require.
- No charting package until a real history endpoint exists. No WebSockets, Redis, Kafka, database, ML, or new backend service.

### Implementation order

1. Complete contract/API, polling, component and deterministic fixture suites.
2. Test wallet connection and all user transaction lifecycle outcomes using mocks/fixtures.
3. Test all LIVE readiness prerequisites and verify each missing item disables transactions.
4. Test the full controlled live enforcement narrative, publisher boundary, post-transaction reread and demo isolation.
5. Review copy for real versus illustrative status and for honest rejection/confirmation labels.
6. Perform responsive/accessibility and keyboard/reduced-motion polish; update docs.

### Testing requirements

- **API/contracts:** valid and malformed values, null versus zero, stale/fresh, partial venue failure, total failure, timeout and source discriminator.
- **Risk UI:** all levels, contagion, drivers, stale/mismatched policy, unavailable state, errors, loading and `N/A` values.
- **Wallet:** connect, disconnect, account change and no signature during connection.
- **Transaction construction:** correct PDA/program/cluster/accounts and allowlist; reject arbitrary/admin instructions.
- **Simulation/lifecycle:** simulation success/rejection, wallet cancellation, RPC failure, pending, confirmed success, confirmed program failure, post-confirmation account refresh.
- **Live flow:** actual or controlled LOW/3x → position → genuine/controlled inputs through existing risk logic → publisher path → verified HIGH/1x RiskState → 2x increase rejection → reduce/close and reread. Clearly label controlled fixtures and do not claim automated tests prove deployment.
- **Security boundaries:** frontend cannot access publisher authority, call `update_risk_state`, rotate authority, configure markets, construct arbitrary instructions, or bypass program checks.
- **Demo isolation:** no wallet calls, signature, RPC write, publisher call, RiskState modification, fake confirmation or fake enforcement.
- Existing Rust LiteSVM suite remains unchanged.

### Security considerations

- The contract is the security boundary; frontend checks only improve UX and never replace on-chain validation.
- No private keys or provider secrets in browser configuration; no publisher authority in the frontend bundle.
- Never report `confirmed` without actual RPC confirmation and verified post-state.
- Distinguish simulation rejection, wallet rejection, RPC failure, pending, confirmed success, and confirmed program failure. Decode/show a program error only when returned by actual simulation or a confirmed transaction.
- Any owner/PDA/discriminator/layout mismatch makes account state unavailable/incompatible; never display invalidly decoded data.
- The planned UI must preserve the Phase 6 valuation-only boundary: do not present unrealized PnL as settled or withdrawable collateral; do not imply losses are absorbed by other users or an insurance fund.

### Acceptance criteria

- All seven phases' acceptance checks pass, and the live-flow demonstration is available only when deployment and publisher requirements are verified.
- Live and demo sources cannot silently mix; demo actions have no wallet/signing/write path.
- User transaction states and actual post-state are accurate.
- UI is responsive, keyboard accessible, uses text plus color for risk, respects reduced motion, and clearly labels live, demo, stale, unavailable, and illustrative information.
- No changes are made to Rust instructions/account layouts, risk algorithms, publisher signing logic, deployment, or migration.

### Explicit non-goals

- No protocol redesign, tests that mutate/deploy a cluster, migration, publisher rewrite, new risk logic, historical market-data backend, automatic liquidation, or PnL settlement.

---

## Global Risk and Unknowns

- The deployed cluster, actual vault address, current program ID and account-layout compatibility remain unverified.
- Existing Phase 5/6 account layouts lack migration; old accounts may not decode under the current schema.
- Publisher outputs are not persisted/served, so a dashboard can verify resulting on-chain `RiskState` but cannot claim publisher history or signature without a separate real event source.
- There is no position valuation endpoint or current PnL/equity output. Do not display collateral health or liquidation status without a separately reviewed trustworthy data path.
- PnL settlement remains deferred; `settlement_reserved` has no release mechanism. Unrealized profit must not become withdrawable collateral.
- No historical API data exists for durable risk charts; skip those initially.
- Fixture outputs require calibration through actual calculations; never promise exact scores before tests establish them.
- Wallet Standard/Kit and generated Codama client compatibility with the repository's pinned Anchor IDL/toolchain must be verified. Isolate any conversion in a narrow adapter.
- Browser RPC URLs are public and public RPC quotas/availability affect simulation and confirmation; use a server-side proxy for credentialed providers.
- Existing `/health` is process-only and cannot be treated as overall operational health.

## Recommended Next Step

Confirm the API snapshot contract and demo boundary, user transaction scope (`increase_position`, `reduce_position`, `close_position`; deposit/withdraw only if separately approved), intended test cluster, deployment/publisher readiness, safe risk-deterioration rehearsal method, and generated-client compatibility. Then implement Phase 1 and Phase 2 before chain reads and wallet actions.

**Honesty rule:** DEMO illustrates the real risk/policy pipeline but is not evidence of live conditions or on-chain enforcement. LIVE enforcement is claimed only when the actual deployment, publisher update, program result, transaction status, and post-state have been verified.
