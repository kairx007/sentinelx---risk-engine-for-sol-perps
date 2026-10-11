# SentinelX — Solana Devnet Deployment Guide

## 1. Executive Summary & Deployment Status

SentinelX is an autonomous risk management engine and risk policy enforcement vault for Solana perpetuals trading. This document details the live deployment of the `risk_vault` Anchor program on Solana Devnet, including active account addresses, initialized state accounts, live Pyth oracle configuration, and instructions for operating or verifying the system.

- **Target Network**: Solana Devnet (`https://api.devnet.solana.com`)
- **Program Name**: `risk_vault`
- **Program ID**: `H1DeHTackptYWeK8EAjLGG6UXG7xFQhkMUgWsdNrm45H`
- **Deployment Transaction**: `5tCUEzZudXfSCyV3rtUC6XFLvrd62weHNwEyjLcsCRkkduJd9CeXNeq16Hztdd7ga1F5utYDGDPHibXxr7u1tabu`
- **Deployment Slot**: `509917924`
- **Solana Explorer**: [View Program on Solana Explorer](https://explorer.solana.com/address/H1DeHTackptYWeK8EAjLGG6UXG7xFQhkMUgWsdNrm45H?cluster=devnet)

---

## 2. On-Chain Addresses & Parameters

### 2.1 Core Addresses

| Entity                         | Public Key / Address                                                 | Description                                          |
| :----------------------------- | :------------------------------------------------------------------- | :--------------------------------------------------- |
| **Program ID**                 | `H1DeHTackptYWeK8EAjLGG6UXG7xFQhkMUgWsdNrm45H`                       | SentinelX Risk Vault Anchor Program                  |
| **Deployer / Admin Wallet**    | `8RCU8wMgADnRuWnqw7D5gQiKowLLAV5j7TH3prR1ZspH`                       | Program upgrade authority & initial vault authority  |
| **Risk Authority**             | `2a3kB5CPXZwUXYd9m1sCsSmnLkkZBvcoKWyczXZUadky`                       | Dedicated signer for publishing risk state updates   |
| **Collateral Mint (USDC)**     | `49rjDqfTwbMZhiayCRaRWhtUyoduSWSzQTD2FdV12xxx`                       | Dedicated 6-decimal test collateral SPL token        |
| **Vault PDA**                  | `FEkEs6odayCCdyiJ7eiPgW4YYyMikyttWHwtCPBpQNB`                        | Seeds: `[b"vault", collateral_mint]`                 |
| **Vault Token Account (ATA)**  | `5h4izJ2U3g1u8AaYcpshBpmpd61L99Vm7B96TwgodufU`                       | Associated token account holding vault collateral    |
| **RiskState PDA**              | `DfPYB2moKqM3j4D1UFNuP3R3ox8hWQBXeYzeeHcwqLMc`                       | Seeds: `[b"risk_state", vault]`                      |
| **Market Key (SOL-PERP)**      | `H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4SE5nv`                       | Identifier for the monitored perp market             |
| **MarketConfig PDA**           | `BRWBBQFrdg5SEKnnTLyu6uGuJ7qFUqxzsQDobsMJu4nn`                       | Seeds: `[b"market_config", vault, market]`           |
| **Pyth Receiver Program**      | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`                        | Official Pyth Push Oracle receiver program on Devnet |
| **Pyth PriceUpdateV2 Account** | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`                       | Active SOL/USD live feed account on Devnet           |
| **Pyth Feed ID (SOL/USD)**     | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` | Feed ID monitored on-chain                           |

### 2.2 Trader Test Account

| Entity                    | Public Key / Address                           | Description                                    |
| :------------------------ | :--------------------------------------------- | :--------------------------------------------- |
| **Trader Authority**      | `8RCU8wMgADnRuWnqw7D5gQiKowLLAV5j7TH3prR1ZspH` | Trader wallet used in demonstration            |
| **Trader Collateral ATA** | `9mSXJjHyRy9KiU5ZinYyAJWGd3cCmFNTEnoDkpJgfUGU` | SPL token account holding user test collateral |
| **UserVaultAccount PDA**  | `Cibr4dUMq72zqVBDF5zQcXvmqep8FsPNFFAaDt5DSxiy` | Seeds: `[b"user_vault", vault, trader_owner]`  |
| **Position PDA**          | `EomkK2z1s5eFk4YxX3fK5U32N9rP4Bv1N5Y7uG8P4pQv` | Seeds: `[b"position", user_vault, market]`     |

---

## 3. Account Initialization Transactions

| Step | Action                        | Transaction Signature                                                                      | Status    |
| :--- | :---------------------------- | :----------------------------------------------------------------------------------------- | :-------- |
| 1    | Create Test Collateral Mint   | Custom SPL Token creation via Solana CLI                                                   | Confirmed |
| 2    | Initialize Vault & RiskState  | `kfoLmdy9D6zMBzj4PmxqUsLyVpcTmjQrLQb1agwFG5BwudooTSzmrznNYgQsCrDJZVEcuoERU4AWcx498MgLSNS`  | Confirmed |
| 3    | Initialize MarketConfig       | `4yqAfNWHifyM2zJNGfcfacaoMKZ65N3Cr3QMGk4KbQGHJ4Y2QAdMHeFy8g4RzuUWGfTdCuoeq45QoDdYoLVQGHWs` | Confirmed |
| 4    | Initialize User Vault Account | `4B9ezUQqpAiK7wrhtrSyXYBaV7yzWejgPDFz3o7coQhWGAQw4ri1xdV9Dc7u3kNasB63KYiyyfMvRUVDTtNyAJbc` | Confirmed |
| 5    | Deposit Collateral (100 USDC) | `4aLbLYGum4NRtuzp71XhcunFFjyBYZjKVRk573vjtwdUfR4aXBsfDUTnwvUeLUZZLMicgE1WLx8NLpXfaQwELrdo` | Confirmed |

---

## 4. Live Risk Enforcement Verification Trail

During deployment validation, the following on-chain actions were executed and confirmed on Solana Devnet:

1. **Publish Initial Risk Policy (LOW Risk - Nonce 1)**:
   - Cap: 3x leverage, allowed contagion: NORMAL.
   - Transaction: `e7cdzHsdabducqddDedAhA8LT7xY5xA9awCZGVUgHzsx8BfBuDTkCi2JUQhVzChcbGq7fmi2E6witRpuZC9LcMx`
2. **Open Position within Risk Envelope**:
   - Size: 2.0 SOL Long @ ~$109.46 (Notional: ~$218.92 vs $100 Collateral = ~2.18x leverage).
   - Expected Result: Success (below 3.0x limit).
   - Transaction: `5gb9icHARuiDUDHiXLGEgNLJ2dMvznSDtM5C7tJRWs6w3dRiBgEjypid4o1LPXTDCw85EKe7ALznNc9sEYeUNpzf`
3. **Escalate Risk State (HIGH Risk - Nonce 2)**:
   - Cap: 1x leverage, allowed contagion: DEVELOPING.
   - Transaction: `3QvgRa28dWZgQ5tAPnQcodKr7hKvme9Ap7SUDfTSepJpG2napc4UxWZ7cK3UY9jMKrNmvSddhogaYAr255e6Htc5`
4. **Attempt Exposure Expansion Under Elevated Risk**:
   - Instruction: `increase_position` with +1.0 SOL Long (would reach ~3.28x leverage, violating 1.0x cap).
   - Expected Result: **Program Rejection**.
   - On-Chain Error: `0x179f` (`InsufficientInitialMargin` at `programs/risk_vault/src/instructions/increase_position.rs:162`).
5. **Permit Risk-Reducing Action (De-risking)**:
   - Instruction: `reduce_position` by 1.0 SOL (reducing exposure by 50%).
   - Expected Result: Success (risk-reducing exits are permitted even during risk escalation).
   - Transaction: `324sPH5a1w3PaaKc8zQouCegUCdvJTKUJJFmfTab65Papenw9qzY52Tg9N69x11fRBok1s1m2hESH2SPx69knsj5`
6. **Close Remaining Position**:
   - Instruction: `close_position` for remaining 1.0 SOL.
   - Transaction: `2K6VBF5TY8rXgXSDKesjMspnHR6BKUWKnEBXRVDbsXDMqLup3gG6syE3YQLUZqapzSuqiHjp6UizQH7nz4cHL8Xn`
7. **De-escalate Risk & Verify Position Reopening (SEC-02 Bug Fix)**:
   - Publish LOW Risk (Nonce 3): `4SFXU2c5sJWHxrtUBmEMBFU3jT9wSJKMgJrZjsLrFiFDYphwS7X5B2fN8Y178ykX8zCZM9rxLzq81cvr3E2i3uE8`
   - Reopen Position: Open 1.0 SOL Short on the same market.
   - Transaction: `2GCk23jidkbrzD6WBN3NACSw9ePQmMgZDBNbKw8ioH4VivR4gxuCRf4Z39kgqsuafBpqmJ7Xw5NsmN2M5imA8JYt`
   - Result: Successful reopening confirmed.

---

## 5. Environment Configuration

### Frontend Dashboard (`apps/dashboard/.env`)

```bash
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_SOLANA_NETWORK=devnet
VITE_RISK_VAULT_PROGRAM_ID=H1DeHTackptYWeK8EAjLGG6UXG7xFQhkMUgWsdNrm45H
VITE_USDC_MINT=49rjDqfTwbMZhiayCRaRWhtUyoduSWSzQTD2FdV12xxx
VITE_VAULT_ADDRESS=FEkEs6odayCCdyiJ7eiPgW4YYyMikyttWHwtCPBpQNB
VITE_RISK_STATE_ADDRESS=DfPYB2moKqM3j4D1UFNuP3R3ox8hWQBXeYzeeHcwqLMc
VITE_SOL_PERP_MARKET=H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4SE5nv
VITE_SOL_USD_FEED_ID=0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
VITE_PYTH_PRICE_UPDATE_ACCOUNT=7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE
```

### Risk Publisher (`apps/risk-publisher/.env`)

```bash
SOLANA_RPC_URL=https://api.devnet.solana.com
RISK_VAULT_PROGRAM_ID=H1DeHTackptYWeK8EAjLGG6UXG7xFQhkMUgWsdNrm45H
VAULT_ADDRESS=FEkEs6odayCCdyiJ7eiPgW4YYyMikyttWHwtCPBpQNB
RISK_STATE_ADDRESS=DfPYB2moKqM3j4D1UFNuP3R3ox8hWQBXeYzeeHcwqLMc
RISK_AUTHORITY_KEYPAIR_PATH=./target/deploy/risk_authority-keypair.json
```

---

## 6. How to Run Locally Against Devnet

1. **Install Dependencies**:

   ```bash
   bun install
   ```

2. **Run Tests & Validation Checks**:

   ```bash
   cargo test --manifest-path anchor/risk_vault/Cargo.toml
   bun run test:unit
   bun run test:integration
   bun run test:dashboard
   bun run typecheck
   bun run check
   ```

3. **Start the Dashboard Connected to Devnet**:
   ```bash
   bun run dev:dashboard
   ```
   Open `http://localhost:5173` in your browser and connect a Devnet-compatible Solana wallet (Phantom, Solflare, etc.).

---

## 7. Known System Constraints & Operational Notes

1. **Pyth Oracle Staleness**: Pyth `PriceUpdateV2` messages have a maximum allowed staleness of 30 seconds (`max_age_seconds: 30`). On Devnet, ensure transactions are submitted with an actively updated Pyth price account.
2. **Nonce Monotonicity**: Risk state updates must supply a strictly increasing `nonce` signed by the authorized `risk_authority` (`2a3kB5CPXZwUXYd9m1sCsSmnLkkZBvcoKWyczXZUadky`).
3. **Collateral Peg Assumption**: Collateral is assumed to be 6-decimal USD-denominated stablecoin ($1.00 USD) without depeg discounting.
4. **Settlement Accounting**: Full peer-to-peer settlement matching is handled through the off-chain matching engine while on-chain margin lockup is enforced by the `risk_vault` program.
