Phase 8 — Contagion Detection
Goal
Detect when risk is spreading between venues.
Don't build a complicated ML/correlation system.
Use observable signals:
price movement
+
OI change
+
liquidity deterioration
+
liquidations
+
volatility

Detect patterns such as:
Venue A stress
      ↓
Venue B liquidation increase
      ↓
Venue C liquidity deterioration

Output:
ContagionState

status:
  NONE
  DEVELOPING
  ACTIVE

affectedVenues
severity
drivers

Also distinguish:
ISOLATED

from:
ECOSYSTEM-WIDE

Phase 9 — API + Dashboard
API
Only implement:
GET /markets

GET /markets/:venue/:symbol

GET /markets/:venue/:symbol/risk

GET /markets/:venue/:symbol/metrics

GET /ecosystem/risk

GET /ecosystem/contagion

No authentication.
No user accounts.
No trading.
Dashboard
Build only 3 views.
1. Ecosystem
Ecosystem Risk: 72 HIGH

Drift       81
Phoenix     63
Jupiter     54

Show:
- risk scores
- OI
- funding
- liquidity
- liquidation activity
2. Market
Detailed view for:
SOL-PERP

Show:
- risk score
- component scores
- metrics
- top risk drivers
3. Contagion
Show:
Drift → Phoenix → Jupiter

with:
- venue risk
- synchronized events
- contagion status
Phase 10 — Final Hackathon Polish
Goal
Make it submission-ready.
Testing
Prioritize:
metrics tests
risk-score tests
adapter tests
cross-venue tests
contagion tests
API tests

Fixtures
Create:
normal-market.json
high-leverage.json
low-liquidity.json
liquidation-event.json
cross-venue-stress.json

Documentation
README should contain:
1. Problem
2. Solution
3. Architecture
4. Supported venues
5. Risk metrics
6. Screenshots
7. Setup
8. Demo
9. Limitations
10. Future roadmap
Final demo story
Live Solana Perp Data
        ↓
Drift / Phoenix / Jupiter
        ↓
Normalization
        ↓
Risk Metrics
        ↓
Risk Engine
        ↓
Cross-Venue Analysis
        ↓
Contagion Detection
        ↓
Dashboard
