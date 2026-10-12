# SentinelX — Autonomous Risk Engine for Solana Perpetuals

SentinelX is an autonomous risk management and intelligence layer for Solana perpetual markets. It continuously monitors cross-venue perp venues (Phoenix & Velocity), calculates real-time risk and divergence metrics, and dynamically enforces leverage caps and collateral requirements on-chain.

---

## ⚡ Quick Start

### 1. Prerequisites
- **[Bun](https://bun.sh/)** (v1.1+) or Node.js (v20+)
- **Solana CLI** (optional, for Anchor / local contract interactions)

### 2. Start the Server & Dashboard
Run the automated start script:

```bash
npm run start
# or
bun run start
# or
./start.sh
```

This automatically installs dependencies, builds shared packages, and spins up:
- 🟢 **Risk API Server**: `http://localhost:3000`
- 🖥️ **Risk Dashboard**: `http://localhost:5173`

Alternatively, start services individually in dev mode:
```bash
# Start backend API (Port 3000)
npm run api:dev

# Start frontend dashboard (Port 5173)
npm run dashboard:dev
```

---

## 🔍 What SentinelX Does

### 1. Multi-Venue Data Aggregation
Ingests live market state from Solana perp venues:
- **Phoenix**: Orderbook depth, mark/index prices, funding, and volume.
- **Velocity**: SDK-driven perp market accounts, open interest, and spreads.

### 2. Cross-Venue Risk & Divergence Engine
Computes a composite **Ecosystem Risk Score (0–100)** and identifies systemic imbalances across 5 key divergence dimensions:
- **Price Divergence**: Spread and coefficient of variation between venue mark prices.
- **Funding Rate Divergence**: Annualized funding rate deviations across markets.
- **Open Interest Concentration**: Herfindahl index (HHI) of venue OI distribution.
- **Liquidity Spread Divergence**: Bid/ask spread expansion across orderbooks.
- **Liquidation Concentration**: Cascading liquidation imbalances.

### 3. On-Chain Risk Policy Enforcement
- Deployed on **Solana Devnet** (`risk_vault` Anchor program: `H1DeHTackptYWeK8EAjLGG6UXG7xFQhkMUgWsdNrm45H`).
- Gated by Pyth oracle prices with configured staleness tolerance.
- Automatically adjusts maximum allowed leverage based on:
  $$\text{Policy Risk} = \max(\text{Venue Risk}_{\text{Phoenix}}, \text{Venue Risk}_{\text{Velocity}}, \text{Ecosystem Risk})$$

### 4. Interactive Live Dashboard
- **Ecosystem Overview**: Live venue comparisons, divergence breakdowns, and methodology explainers.
- **Position Execution**: Live test USDC faucet, deposit/increase/reduce/close positions, and simulation before on-chain submission.
- **Contagion Monitor**: Detects isolated vs. active systemic contagion states.

---

## 🧪 Testing

```bash
# Run all unit tests
npm run test:unit

# Run frontend dashboard tests
npm run test:dashboard

# Run Rust Anchor program tests
npm run test:anchor

# Run full test suite
npm run test:all
```

---

## 📁 Repository Structure

```
├── anchor/              # Solana Anchor smart contracts (risk_vault)
├── apps/
│   ├── api/             # Express/Bun backend API service
│   ├── dashboard/       # React + Vite live risk dashboard
│   └── risk-publisher/  # On-chain risk state publisher
├── packages/
│   ├── adapters/        # Venue adapters (Phoenix, Velocity, Drift, Jupiter)
│   ├── api-contracts/   # Zod validation schemas and shared types
│   ├── cross-venue/     # Divergence calculation & contagion models
│   ├── metrics/         # Financial and statistical risk metrics
│   └── risk/            # Core scoring formulas and threshold interpolators
└── start.sh             # One-step startup script
```

---

## 📄 License
MIT
