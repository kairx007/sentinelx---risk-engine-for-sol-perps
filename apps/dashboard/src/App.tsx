import { useState } from "react";
import type { DashboardSnapshot } from "../../../packages/api-contracts/src/dashboard";
import { useDashboardSnapshot } from "./hooks/useDashboardSnapshot";
import { useOnChainRiskState } from "./hooks/useOnChainRiskState";
import { OnChainRiskState } from "./components/OnChainRiskState";
import { WalletProvider } from "./solana/wallet";
import { WalletConnect } from "./components/WalletConnect";
import { UserTransactionPanel } from "./components/UserTransactionPanel";

type View = "Ecosystem" | "Market" | "Contagion";
type Venue = DashboardSnapshot["venues"][number];

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    grid: "M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z",
    chart: "M3 3v18h18 M7 14l4-4 4 3 6-8",
    pulse: "M2 12h4l3-8 5 16 3-8h5",
    search:
      "m21 21-4.3-4.3 M10.8 18a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4Z",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
    chevron: "m9 18 6-6-6-6",
    arrow: "M7 17 17 7 M7 7h10v10",
    check: "m5 12 4 4L19 6",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.grid} />
    </svg>
  );
}

function levelTone(level: string | null | undefined): string {
  return level && ["low", "medium", "high", "critical"].includes(level)
    ? level
    : "neutral";
}

function formatNumber(
  value: number | null | undefined,
  options: Intl.NumberFormatOptions = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "N/A";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
}

function formatAmount(
  value: number | null | undefined,
  unit: string | null | undefined,
  quoteAsset = "USD",
): string {
  if (value === null || value === undefined || !Number.isFinite(value) || !unit)
    return "N/A";
  if (unit === "quote") return `${formatNumber(value)} ${quoteAsset}`;
  return `${formatNumber(value)} ${unit}`;
}

function resolveLiquidityAmount(
  liquidity: Venue["state"] extends infer S
    ? S extends { liquidity: infer L }
      ? L
      : undefined
    : undefined,
): number | null {
  if (!liquidity) return null;
  if (liquidity.availableLiquidity != null) return liquidity.availableLiquidity;
  if (liquidity.bidSize != null && liquidity.askSize != null) {
    return Math.min(liquidity.bidSize, liquidity.askSize);
  }
  return liquidity.bidSize ?? liquidity.askSize ?? null;
}

function venueLabel(venue: string): string {
  return venue.charAt(0).toUpperCase() + venue.slice(1);
}

function venueStatusLabel(item: Venue): string {
  return item.status === "available"
    ? (item.risk?.level ?? "unavailable")
    : item.status;
}

function venueStatusTone(item: Venue): string {
  if (item.status === "stale") return "medium";
  if (item.status === "invalid") return "high";
  if (item.status === "unavailable") return "neutral";
  return levelTone(item.risk?.level);
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function SnapshotNotice({
  status,
  error,
  stale,
  updatedAt,
}: {
  status: string;
  error: string | null;
  stale: boolean;
  updatedAt: string | null;
}) {
  if (status === "loading")
    return (
      <div className="snapshot-notice notice-loading" role="status">
        Connecting to the live risk API…
      </div>
    );
  if (status === "error")
    return (
      <div className="snapshot-notice notice-error" role="alert">
        Live data unavailable: {error ?? "The API could not be reached."}
      </div>
    );
  if (stale)
    return (
      <div className="snapshot-notice notice-stale" role="status">
        Showing retained data · last successful snapshot{" "}
        {updatedAt ? new Date(updatedAt).toLocaleTimeString() : "unknown"} ·{" "}
        {error ?? "data is stale"}
      </div>
    );
  if (error)
    return (
      <div className="snapshot-notice notice-stale" role="status">
        Latest refresh failed: {error}. Retained snapshot remains visible.
      </div>
    );
  return null;
}

function EcosystemView({
  snapshot,
  onMarket,
}: {
  snapshot: DashboardSnapshot | null;
  onMarket: (venue?: string) => void;
}) {
  const ecosystem = snapshot?.ecosystem;
  const venues = snapshot?.venues ?? [];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            OVERVIEW <span>/</span> ECOSYSTEM
          </div>
          <h1>Ecosystem overview</h1>
          <p className="page-subtitle">
            Live venue risk and market metrics from the risk API.
          </p>
        </div>
        <Badge tone="neutral">{snapshot?.source ?? "LIVE"} SNAPSHOT</Badge>
      </div>
      <section className="hero-card">
        <div className="hero-copy">
          <div className="eyebrow">ECOSYSTEM RISK</div>
          <h2>
            {ecosystem?.ecosystemScore == null
              ? "Combined risk unavailable"
              : `Risk is ${ecosystem.ecosystemLevel ?? "unclassified"}`}
          </h2>
          <p>
            {ecosystem
              ? `${ecosystem.venueCount} venue${ecosystem.venueCount === 1 ? "" : "s"} contributed to this snapshot. Risk drivers are calculated by the backend risk engine.`
              : "Combined risk requires fresh data from both Velocity and Phoenix."}
          </p>
          <button className="button button-primary" onClick={() => onMarket()}>
            View market detail <Icon name="arrow" size={15} />
          </button>
        </div>
        <div className="hero-score">
          <div className="risk-gauge">
            <div className="gauge-number">
              {ecosystem?.ecosystemScore ?? "—"}
              <span>/100</span>
            </div>
            <div className="gauge-caption">ECOSYSTEM RISK</div>
          </div>
          <div className="score-meta">
            <Badge tone={levelTone(ecosystem?.ecosystemLevel)}>
              {ecosystem?.ecosystemLevel?.toUpperCase() ?? "UNAVAILABLE"}
            </Badge>
            <span className="score-change">
              {ecosystem?.venueCount ?? 0} <small>venues</small>
            </span>
          </div>
          <div className="sparkline unavailable-chart">
            Live score history is not provided by this API.
          </div>
        </div>
      </section>
      <div className="section-heading">
        <div>
          <h2>Venue risk</h2>
          <p>Market observations and per-venue risk scores.</p>
        </div>
        <button className="text-button" onClick={() => onMarket()}>
          View market details <Icon name="chevron" size={14} />
        </button>
      </div>
      <section className="venue-table card">
        <div className="table-head">
          <span>VENUE</span>
          <span>RISK SCORE</span>
          <span>OPEN INTEREST</span>
          <span>FUNDING RATE</span>
          <span>LIQUIDITY</span>
          <span>LIQUIDATIONS</span>
        </div>
        {venues.map((item) => (
          <VenueRow key={item.venue} item={item} onClick={() => onMarket(item.venue)} />
        ))}
        {venues.length === 0 && (
          <div className="empty-state">
            Venue data will appear when the API returns a snapshot.
          </div>
        )}
      </section>
      <div className="bottom-grid">
        <section className="card signal-card">
          <div className="card-title">
            <div>
              <span className="mini-icon orange">
                <Icon name="pulse" size={16} />
              </span>
              <h2>Risk drivers</h2>
            </div>
            <span className="muted">Backend output</span>
          </div>
          {ecosystem?.riskDrivers.length ? (
            ecosystem.riskDrivers.map((driver, index) => (
              <div className="signal-row" key={`${driver}-${index}`}>
                <span className="signal-mark mark-orange">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong>{driver}</strong>
                  <small>Reported by ecosystem risk calculation</small>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state compact">
              No combined risk drivers available.
            </div>
          )}
        </section>
        <section className="card activity-card">
          <div className="card-title">
            <div>
              <span className="mini-icon blue">
                <Icon name="chart" size={16} />
              </span>
              <h2>Cross-venue divergence</h2>
            </div>
          </div>
          <MetricLine
            label="Price"
            value={ecosystem?.divergence.price}
            suffix="%"
          />
          <MetricLine label="Funding" value={ecosystem?.divergence.funding} />
          <MetricLine
            label="OI concentration"
            value={ecosystem?.divergence.oiConcentration}
          />
          <MetricLine
            label="Liquidity spread"
            value={ecosystem?.divergence.liquiditySpread}
            suffix="%"
          />
        </section>
      </div>
      <PolicyPanel snapshot={snapshot} />
    </>
  );
}

function VenueRow({ item, onClick }: { item: Venue; onClick: () => void }) {
  const state = item.state;
  const risk = item.risk;
  const tone = venueStatusTone(item);
  return (
    <button className="venue-row" onClick={onClick}>
      <span className="venue-name">
        <span className={`venue-logo logo-${item.venue.slice(0, 2)}`}>
          {item.venue.slice(0, 2).toUpperCase()}
        </span>
        <span>
          <strong>{venueLabel(item.venue)}</strong>
          <small>
            {item.status === "available" || item.status === "stale"
              ? state?.market.symbol
              : "Unavailable"}
          </small>
        </span>
      </span>
      <span className="risk-cell">
        <span className="risk-bar">
          <i
            className={`fill-${tone}`}
            style={{ width: `${risk?.overallScore ?? 0}%` }}
          />
        </span>
        <strong>{risk?.overallScore ?? "N/A"}</strong>
        <Badge tone={tone}>{venueStatusLabel(item)}</Badge>
      </span>
      <strong>
        {formatAmount(
          state?.positioning.totalOpenInterest,
          state?.positioning.openInterestUnit,
          state?.market.quoteAsset,
        )}
      </strong>
      <span className={state?.funding.rate == null ? "muted" : "positive"}>
        {state?.funding.rate == null
          ? "N/A"
          : `${formatNumber(state.funding.rate * 100, { maximumFractionDigits: 4 })}%`}
      </span>
      <strong>
        {formatAmount(
          resolveLiquidityAmount(state?.liquidity),
          state?.liquidity.liquidityUnit,
          state?.market.quoteAsset,
        )}
      </strong>
      <span className="liquidations">
        {formatAmount(
          state?.liquidation.totalVolume,
          state?.liquidation.volumeUnit,
          state?.market.quoteAsset,
        )}
        <small>
          {state?.liquidation.intervalSeconds
            ? `${state.liquidation.intervalSeconds}s window`
            : "window unavailable"}
        </small>
      </span>
    </button>
  );
}

function MetricLine({
  label,
  value,
  suffix = "",
}: {
  label: string;
  value: number | null | undefined;
  suffix?: string;
}) {
  return (
    <div className="metric-line">
      <span>{label}</span>
      <strong>
        {value == null ? "N/A" : `${formatNumber(value)}${suffix}`}
      </strong>
    </div>
  );
}

function PolicyPanel({ snapshot }: { snapshot: DashboardSnapshot | null }) {
  const policy = snapshot?.policy;
  const decision = policy?.decision;
  return (
    <section className="card drivers-card policy-card">
      <div className="card-title">
        <div>
          <span className="mini-icon blue">
            <Icon name="check" size={16} />
          </span>
          <h2>Off-chain risk policy</h2>
        </div>
        <Badge tone={policy?.status === "available" ? "low" : "neutral"}>
          {policy?.status === "available" ? "AVAILABLE" : "UNAVAILABLE"}
        </Badge>
      </div>
      {decision ? (
        <div className="policy-values">
          <div className="metric-line">
            <span>Risk level</span>
            <strong>
              {decision.riskLevel.toUpperCase()} · {decision.riskScore}/100
            </strong>
          </div>
          <div className="metric-line">
            <span>Contagion state</span>
            <strong>{decision.contagionState}</strong>
          </div>
          <div className="metric-line">
            <span>Max leverage cap</span>
            <strong>{formatNumber(decision.maxLeverageX100 / 100)}×</strong>
          </div>
        </div>
      ) : (
        <div className="empty-state compact">
          {policy?.reason ?? "Policy inputs are unavailable."}
        </div>
      )}
      <p className="policy-note">
        Calculated off-chain policy output. Compare with the separately verified
        on-chain RiskState below.
      </p>
    </section>
  );
}

function MarketView({
  snapshot,
  selectedVenue,
  onSelectVenue,
}: {
  snapshot: DashboardSnapshot | null;
  selectedVenue?: string;
  onSelectVenue?: (venue: string) => void;
}) {
  const selected =
    (selectedVenue
      ? snapshot?.venues.find((item) => item.venue === selectedVenue)
      : null) ??
    snapshot?.venues.find((item) => item.status === "available") ??
    snapshot?.venues[0];
  const state = selected?.state;
  const risk = selected?.risk;
  const components = Object.entries(risk?.components ?? {});
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            MARKETS <span>/</span>{" "}
            {selected ? selected.venue.toUpperCase() : "LIVE"} <span>/</span>{" "}
            {snapshot?.symbol ?? "SOL-PERP"}
          </div>
          <h1>
            {snapshot?.symbol ?? "SOL-PERP"}{" "}
            <Badge tone={selected ? venueStatusTone(selected) : "neutral"}>
              {selected
                ? venueStatusLabel(selected).toUpperCase()
                : "UNAVAILABLE"}
            </Badge>
          </h1>
          <p className="page-subtitle">
            {selected
              ? `${venueLabel(selected.venue)} · ${state?.market.baseAsset ?? "Market"} / ${state?.market.quoteAsset ?? ""}`
              : "No venue data available"}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {(snapshot?.venues ?? []).map((item) => (
            <button
              key={item.venue}
              className={`button ${selected?.venue === item.venue ? "button-primary" : "button-secondary"}`}
              style={{
                padding: "8px 16px",
                fontSize: "13px",
                cursor: "pointer",
                borderRadius: "6px",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
              onClick={() => onSelectVenue?.(item.venue)}
            >
              <span className={`venue-logo logo-${item.venue.slice(0, 2)}`}>
                {item.venue.slice(0, 2).toUpperCase()}
              </span>
              <span>{venueLabel(item.venue)}</span>
              <Badge tone={venueStatusTone(item)}>
                {venueStatusLabel(item)}
              </Badge>
            </button>
          ))}
        </div>
      </div>
      <div className="market-summary-grid">
        <section className="card market-risk-card">
          <span className="eyebrow">OVERALL RISK SCORE</span>
          <div className="market-score">
            {risk?.overallScore ?? "—"}
            <span>/100</span>
          </div>
          <div className="risk-bar large">
            <i
              className={`fill-${levelTone(risk?.level)}`}
              style={{ width: `${risk?.overallScore ?? 0}%` }}
            />
          </div>
          <div className="muted">
            {risk
              ? `Calculated ${new Date(risk.timestamp).toLocaleTimeString()}`
              : (selected?.error ?? "Risk score unavailable.")}
          </div>
        </section>
        {[
          [
            "MARK PRICE",
            state?.price.markPrice != null
              ? `$${formatNumber(state.price.markPrice)}`
              : "N/A",
          ],
          [
            "ORACLE PRICE",
            state?.oracle.price != null
              ? `$${formatNumber(state.oracle.price)}`
              : state?.price.indexPrice != null
                ? `$${formatNumber(state.price.indexPrice)}`
                : "N/A",
          ],
          [
            "BEST BID / ASK",
            state?.liquidity.bestBidPrice != null &&
            state?.liquidity.bestAskPrice != null
              ? `$${formatNumber(state.liquidity.bestBidPrice)} / $${formatNumber(state.liquidity.bestAskPrice)}`
              : "N/A",
          ],
          [
            "OPEN INTEREST",
            formatAmount(
              state?.positioning.totalOpenInterest,
              state?.positioning.openInterestUnit,
              state?.market.quoteAsset,
            ),
          ],
          [
            "FUNDING RATE",
            state?.funding.rate == null
              ? "N/A"
              : `${formatNumber(state.funding.rate * 100, { maximumFractionDigits: 4 })}%`,
          ],
          [
            "AVAILABLE LIQUIDITY",
            formatAmount(
              resolveLiquidityAmount(state?.liquidity),
              state?.liquidity.liquidityUnit,
              state?.market.quoteAsset,
            ),
          ],
        ].map(([title, value]) => (
          <section className="card metric-card" key={title}>
            <span className="eyebrow">{title}</span>
            <strong>{value}</strong>
            <span className="metric-note">
              {value === "N/A"
                ? "Not reported by source"
                : "Current observation"}
            </span>
          </section>
        ))}
      </div>
      <div className="section-heading">
        <div>
          <h2>Risk components</h2>
          <p>Component scores calculated by the backend risk engine.</p>
        </div>
        <span className="muted">
          {risk
            ? `Updated ${new Date(risk.timestamp).toLocaleTimeString()}`
            : "Unavailable"}
        </span>
      </div>
      <div className="component-grid">
        {components.map(([label, component]) => (
          <section className="card component-card" key={label}>
            <div className="component-top">
              <span>{label}</span>
              <strong>
                {component.score}
                <small>/100</small>
              </strong>
            </div>
            <div className="risk-bar">
              <i
                className={`fill-${levelTone(component.level)}`}
                style={{ width: `${component.score}%` }}
              />
            </div>
            <p>
              {component.drivers.length
                ? component.drivers.join(" · ")
                : `${component.level} risk contribution.`}
            </p>
          </section>
        ))}
        {components.length === 0 && (
          <section className="card component-card empty-state">
            Component scores are unavailable for this market.
          </section>
        )}
      </div>
      <section className="card drivers-card">
        <div className="card-title">
          <div>
            <span className="mini-icon orange">
              <Icon name="pulse" size={16} />
            </span>
            <h2>Top risk drivers</h2>
          </div>
          <Badge tone="neutral">{risk?.topDrivers.length ?? 0} REPORTED</Badge>
        </div>
        {risk?.topDrivers.length ? (
          risk.topDrivers.map((driver, index) => (
            <div className="driver-row" key={`${driver}-${index}`}>
              <span className="driver-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <strong>{driver}</strong>
                <p>Backend-calculated market risk driver.</p>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state compact">
            No risk drivers are available.
          </div>
        )}
      </section>
    </>
  );
}

function ContagionView({ snapshot }: { snapshot: DashboardSnapshot | null }) {
  const contagion = snapshot?.contagion;
  const affected = new Set(contagion?.affectedVenues ?? []);
  const venues = [...(snapshot?.venues ?? [])].sort(
    (a, b) => Number(affected.has(b.venue)) - Number(affected.has(a.venue)),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            OVERVIEW <span>/</span> CONTAGION
          </div>
          <h1>Contagion monitor</h1>
          <p className="page-subtitle">
            Cross-venue stress assessment from the existing risk engine.
          </p>
        </div>
        <Badge tone={contagion?.severity ?? "neutral"}>
          {contagion?.status ?? "UNAVAILABLE"}
        </Badge>
      </div>
      <section className="contagion-banner">
        <div>
          <div className="eyebrow">
            CONTAGION STATUS ·{" "}
            {contagion
              ? new Date(contagion.timestamp).toLocaleTimeString()
              : "NO SNAPSHOT"}
          </div>
          <h2>
            {contagion
              ? contagion.status === "NONE"
                ? "No contagion detected"
                : `${contagion.status.toLowerCase()} contagion signal`
              : "Contagion assessment unavailable"}
          </h2>
          <p>
            {contagion
              ? `${contagion.affectedVenues.length} affected venue${contagion.affectedVenues.length === 1 ? "" : "s"} reported. This signal is calculated from available cross-venue observations.`
              : "Contagion requires fresh observations from both supported venue feeds."}
          </p>
        </div>
        <div className="severity">
          <span>SEVERITY</span>
          <strong>{contagion?.severity?.toUpperCase() ?? "—"}</strong>
        </div>
      </section>
      <section className="card flow-card">
        <div className="card-title">
          <div>
            <span className="mini-icon orange">
              <Icon name="pulse" size={16} />
            </span>
            <h2>Venue observations</h2>
          </div>
          <Badge tone={contagion ? "neutral" : "high"}>
            {contagion ? `${affected.size} AFFECTED` : "UNAVAILABLE"}
          </Badge>
        </div>
        <div className="flow-chain">
          {venues.map((item, index) => (
            <div className="flow-item" key={item.venue}>
              <div className={`flow-node node-${index}`}>
                <span className="flow-node-top">
                  <span className={`venue-logo logo-${item.venue.slice(0, 2)}`}>
                    {item.venue.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="flow-status">
                    <i />{" "}
                    {item.status === "available"
                      ? affected.has(item.venue)
                        ? "Affected"
                        : "Observed"
                      : "Unavailable"}
                  </span>
                </span>
                <strong>{venueLabel(item.venue)}</strong>
                <small>
                  {affected.has(item.venue)
                    ? "Included in affected venue set"
                    : item.status === "available"
                      ? "No contagion impact reported"
                      : item.error}
                </small>
                <span className="flow-risk">
                  Risk score{" "}
                  <b>
                    {item.risk?.overallScore ?? "N/A"}{" "}
                    <em>{venueStatusLabel(item).toUpperCase()}</em>
                  </b>
                </span>
              </div>
              {index < venues.length - 1 && (
                <div className="flow-connector">
                  <span>CROSS-VENUE</span>
                  <i />
                  <Icon name="chevron" size={15} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      <div className="section-heading">
        <div>
          <h2>Contagion drivers</h2>
          <p>Signals returned by the contagion calculation.</p>
        </div>
        <span className="muted">
          {contagion
            ? new Date(contagion.timestamp).toLocaleTimeString()
            : "Unavailable"}
        </span>
      </div>
      <section className="card drivers-card contagion-drivers">
        {contagion?.drivers.length ? (
          contagion.drivers.map((driver, index) => (
            <div className="driver-row" key={`${driver}-${index}`}>
              <span className="driver-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <strong>{driver}</strong>
                <p>Reported as a contagion driver by the backend.</p>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state compact">
            {contagion
              ? "No contagion drivers reported."
              : "No contagion data available."}
          </div>
        )}
      </section>
      <div className="contagion-footnote">
        <span className="info-mark">i</span>
        <p>
          This API returns affected venues and drivers, but does not provide
          directional propagation or synchronized event history.
        </p>
      </div>
    </>
  );
}

function DashboardContent() {
  const [view, setView] = useState<View>("Ecosystem");
  const [selectedVenue, setSelectedVenue] = useState<string>("phoenix");
  const [search, setSearch] = useState(false);
  const snapshotState = useDashboardSnapshot("SOL-PERP");
  const chainSnapshot = useOnChainRiskState();
  const { data: snapshot, status, error, stale, lastUpdatedAt } = snapshotState;
  const navItems: { name: View; icon: string }[] = [
    { name: "Ecosystem", icon: "grid" },
    { name: "Market", icon: "chart" },
    { name: "Contagion", icon: "pulse" },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#ecosystem"
          onClick={(event) => {
            event.preventDefault();
            setView("Ecosystem");
          }}
        >
          <span className="brand-mark">
            <Icon name="pulse" size={20} />
          </span>
          <span>
            Sentinel<span className="brand-x">X</span>
            <small>RISK INTELLIGENCE</small>
          </span>
        </a>
        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Dashboard views">
          {navItems.map(({ name, icon }) => (
            <button
              key={name}
              onClick={() => setView(name)}
              className={`nav-item ${view === name ? "selected" : ""}`}
              aria-current={view === name ? "page" : undefined}
            >
              <Icon name={icon} size={17} />
              <span>{name}</span>
              {name === "Contagion" &&
                snapshot?.contagion?.status &&
                snapshot.contagion.status !== "NONE" && (
                  <i className="nav-alert" />
                )}
            </button>
          ))}
        </nav>
        <div className="side-label markets-label">SUPPORTED VENUES</div>
        {(snapshot?.venues ?? []).map((item) => (
          <button
            className={`market-nav ${view === "Market" && selectedVenue === item.venue ? "selected" : ""}`}
            key={item.venue}
            onClick={() => {
              setSelectedVenue(item.venue);
              setView("Market");
            }}
          >
            <span className={`venue-logo logo-${item.venue.slice(0, 2)}`}>
              {item.venue.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>{venueLabel(item.venue)}</strong>
              <small>
                {item.status === "available" || item.status === "stale"
                  ? item.state?.market.symbol
                  : item.status === "invalid"
                    ? "Invalid data"
                    : "Unavailable"}
              </small>
            </span>
            <span className="market-nav-score">
              {item.risk?.overallScore ?? "—"}
            </span>
          </button>
        ))}
        <div className="sidebar-bottom">
          <div className="connection">
            <span
              className={
                status === "ready" && !stale ? "live-dot" : "status-dot-offline"
              }
            />
            <span>
              <strong>Risk API</strong>
              <small>
                {status === "ready" && !stale
                  ? "Snapshot current"
                  : stale
                    ? "Snapshot stale"
                    : status === "loading"
                      ? "Connecting…"
                      : "Unavailable"}
              </small>
            </span>
            {status === "ready" && !stale && <Icon name="check" size={14} />}
          </div>
          <div className="profile">
            <span className="avatar">SX</span>
            <span>
              <strong>Read-only dashboard</strong>
              <small>LIVE data source</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <Icon name="chevron" size={13} />
            <strong>{view}</strong>
          </div>
          <div className="topbar-actions">
            <div className="network-pill">
              <span
                className={
                  status === "ready" && !stale
                    ? "live-dot"
                    : "status-dot-offline"
                }
              />{" "}
              Risk API{" "}
              <span className="chevron">
                {status === "ready" && !stale
                  ? "LIVE"
                  : stale
                    ? "STALE"
                    : "OFFLINE"}
              </span>
            </div>
            <WalletConnect />
            <button
              className="icon-button search-button"
              aria-label="Open market search"
              onClick={() => setSearch(!search)}
            >
              <Icon name="search" />
            </button>
            <span className="top-divider" />
            <span className="top-avatar">SX</span>
          </div>
        </header>
        {search && (
          <div className="search-panel">
            <Icon name="search" size={16} />
            <input
              autoFocus
              defaultValue="SOL-PERP"
              aria-label="Search markets"
              placeholder="Search markets, venues…"
            />
            <button onClick={() => setSearch(false)}>ESC</button>
          </div>
        )}
        <main className="content">
          <div className="content-inner">
            <SnapshotNotice
              status={status}
              error={error}
              stale={stale}
              updatedAt={lastUpdatedAt}
            />
            {view === "Ecosystem" ? (
              <EcosystemView
                snapshot={snapshot}
                onMarket={(venue) => {
                  if (venue) setSelectedVenue(venue);
                  setView("Market");
                }}
              />
            ) : view === "Market" ? (
              <MarketView
                snapshot={snapshot}
                selectedVenue={selectedVenue}
                onSelectVenue={setSelectedVenue}
              />
            ) : (
              <ContagionView snapshot={snapshot} />
            )}
            {view === "Ecosystem" && (
              <>
                <OnChainRiskState
                  snapshot={chainSnapshot}
                  decision={snapshot?.policy.decision ?? null}
                />
                <UserTransactionPanel chainSnapshot={chainSnapshot} />
              </>
            )}
            <footer className="footer">
              <span>
                SentinelX <b>·</b> Risk intelligence for Solana perpetuals
              </span>
              <span>
                {lastUpdatedAt
                  ? `Snapshot ${new Date(lastUpdatedAt).toLocaleTimeString()}`
                  : "Waiting for first snapshot"}
              </span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <WalletProvider>
      <DashboardContent />
    </WalletProvider>
  );
}

export default App;

