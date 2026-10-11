# SentinelX — Solana Devnet Demonstration Script & Runbook

This runbook provides the exact, reproducible demonstration workflow for the **SentinelX** risk management engine on Solana Devnet. It shows how SentinelX dynamically enforces risk policies on-chain, prevents toxic exposure during high contagion, and preserves user de-risking actions.

---

## 1. Demo Storyline Overview

The demonstration models an active perpetuals trading venue undergoing liquidity stress:

1. **Normal Market (LOW Risk)**: A trader deposits collateral and opens a 2.0 SOL Long position (~2.18x leverage).
2. **Contagion Event (HIGH Risk)**: SentinelX detects cross-venue liquidity stress across Velocity and Phoenix, publishing a tightened 1x leverage risk policy on-chain.
3. **Rejection of Over-leveraged Trade**: The trader attempts to add +1.0 SOL exposure. The on-chain Anchor program detects the violation and aborts with `InsufficientInitialMargin`.
4. **De-risking Allowed**: The trader executes a 50% position reduction and closes out safely, proving that risk-reducing actions are preserved under high risk.
5. **Recovery & Position Reopening**: Risk returns to LOW, and the trader reopens a position on the same market, proving the SEC-02 closed-position reopening fix.

---

## 2. On-Chain Environment & Addresses

- **Program ID**: `H1DeHTackptYWeK8EAjLGG6UXG7xFQhkMUgWsdNrm45H`
- **Cluster**: Solana Devnet (`https://api.devnet.solana.com`)
- **Vault PDA**: `FEkEs6odayCCdyiJ7eiPgW4YYyMikyttWHwtCPBpQNB`
- **RiskState PDA**: `DfPYB2moKqM3j4D1UFNuP3R3ox8hWQBXeYzeeHcwqLMc`
- **Market Config**: `BRWBBQFrdg5SEKnnTLyu6uGuJ7qFUqxzsQDobsMJu4nn`
- **Market Key**: `H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4SE5nv` (SOL-PERP)
- **Live Pyth Feed**: `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` (SOL/USD)
- **Collateral Token**: `49rjDqfTwbMZhiayCRaRWhtUyoduSWSzQTD2FdV12xxx` (USDC)

---

## 3. Step-by-Step Live Demonstration

### Step 1: Initialize Risk State (LOW Risk)

The off-chain risk publisher signs and transmits the initial policy:

- **Max Leverage**: 3x
- **Contagion Level**: Normal
- **Transaction Signature**:
  ```
  e7cdzHsdabducqddDedAhA8LT7xY5xA9awCZGVUgHzsx8BfBuDTkCi2JUQhVzChcbGq7fmi2E6witRpuZC9LcMx
  ```
- **Solana Explorer**: [View Transaction](https://explorer.solana.com/tx/e7cdzHsdabducqddDedAhA8LT7xY5xA9awCZGVUgHzsx8BfBuDTkCi2JUQhVzChcbGq7fmi2E6witRpuZC9LcMx?cluster=devnet)

### Step 2: Deposit Collateral & Open Position

The trader deposits 100 USDC and opens a 2.0 SOL Long position:

- **Deposit Transaction**:
  ```
  4aLbLYGum4NRtuzp71XhcunFFjyBYZjKVRk573vjtwdUfR4aXBsfDUTnwvUeLUZZLMicgE1WLx8NLpXfaQwELrdo
  ```
- **Open Position (2.0 SOL @ ~$109.46, 2.18x Leverage)**:
  ```
  5gb9icHARuiDUDHiXLGEgNLJ2dMvznSDtM5C7tJRWs6w3dRiBgEjypid4o1LPXTDCw85EKe7ALznNc9sEYeUNpzf
  ```
- **Result**: Confirmed. Position opened within the 3x envelope.

### Step 3: Trigger Cross-Venue Contagion (Escalate to HIGH Risk)

SentinelX flags cascading liquidations across secondary venues and publishes a HIGH risk state on-chain:

- **Max Leverage**: 1x
- **Contagion Level**: Developing
- **Transaction Signature**:
  ```
  3QvgRa28dWZgQ5tAPnQcodKr7hKvme9Ap7SUDfTSepJpG2napc4UxWZ7cK3UY9jMKrNmvSddhogaYAr255e6Htc5
  ```
- **Solana Explorer**: [View Transaction](https://explorer.solana.com/tx/3QvgRa28dWZgQ5tAPnQcodKr7hKvme9Ap7SUDfTSepJpG2napc4UxWZ7cK3UY9jMKrNmvSddhogaYAr255e6Htc5?cluster=devnet)

### Step 4: Attempt Over-leveraged Increase (Verified Failure)

The trader tries to increase the long position by +1.0 SOL:

- **Result**: Transaction Simulation Fails with Program Error.
- **Error Code**: `0x179f` (`6047`) — `InsufficientInitialMargin`
- **Program Log**:
  ```
  Program H1DeHTackptYWeK8EAjLGG6UXG7xFQhkMUgWsdNrm45H invoke [1]
  Program log: Instruction: IncreasePosition
  Program log: AnchorError caused by account: position. Error Code: InsufficientInitialMargin. Error Number: 6047. Error Message: Insufficient initial margin for requested position.
  Program H1DeHTackptYWeK8EAjLGG6UXG7xFQhkMUgWsdNrm45H consumed 48215 of 200000 compute units
  Program H1DeHTackptYWeK8EAjLGG6UXG7xFQhkMUgWsdNrm45H failed: custom program error: 0x179f
  ```
- **Significance**: Proves that SentinelX dynamically constrains protocol risk and protects the vault from excess exposure during market stress.

### Step 5: De-risk and Exit Under Elevated Risk

The trader de-risks their exposure by reducing the position 50%, then closes it completely:

- **Reduce Position (1.0 SOL)**:
  ```
  324sPH5a1w3PaaKc8zQouCegUCdvJTKUJJFmfTab65Papenw9qzY52Tg9N69x11fRBok1s1m2hESH2SPx69knsj5
  ```
- **Close Position**:
  ```
  2K6VBF5TY8rXgXSDKesjMspnHR6BKUWKnEBXRVDbsXDMqLup3gG6syE3YQLUZqapzSuqiHjp6UizQH7nz4cHL8Xn
  ```
- **Significance**: Confirms that risk policies do not trap users; safe exits remain unblocked.

### Step 6: Market Normalization & Reopening Verification (SEC-02 Fix)

Risk policy is lowered back to LOW, and the trader reopens a 1.0 SOL Short on the same market:

- **Normalize Risk Policy**:
  ```
  4SFXU2c5sJWHxrtUBmEMBFU3jT9wSJKMgJrZjsLrFiFDYphwS7X5B2fN8Y178ykX8zCZM9rxLzq81cvr3E2i3uE8
  ```
- **Reopen Position (1.0 SOL Short)**:
  ```
  2GCk23jidkbrzD6WBN3NACSw9ePQmMgZDBNbKw8ioH4VivR4gxuCRf4Z39kgqsuafBpqmJ7Xw5NsmN2M5imA8JYt
  ```
- **Significance**: Demonstrates live verification of the SEC-02 remediation where closed positions can be cleanly reopened without account state corruption.

---

## 4. UI Walkthrough

To demo SentinelX visually:

1. Start the frontend dashboard: `bun run dev:dashboard`.
2. Connect a Devnet wallet (such as Phantom) to `http://localhost:5173`.
3. The dashboard automatically syncs with the live on-chain `RiskState` PDA:
   - Live Risk Level Badge (**LOW / HIGH / CRITICAL**)
   - Max Leverage Ceiling Display (**3x -> 1x -> 0x**)
   - Real-time Pyth SOL/USD price tick from `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`
4. Use the **User Transaction Panel** to execute deposits, position modifications, and withdrawals directly against the deployed Devnet program.
