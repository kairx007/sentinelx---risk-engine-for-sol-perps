import { useState } from "react";

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: "FEED" | "POLICY" | "PUBLISH" | "SIMULATION" | "TX";
  title: string;
  detail: string;
  status: "success" | "warning" | "error" | "info";
  link?: string;
}

export function EventTimeline({
  recentEvents = [],
}: {
  recentEvents?: TimelineEvent[];
}) {
  const [filter, setFilter] = useState<string>("ALL");

  const defaultEvents: TimelineEvent[] = [
    {
      id: "ev-1",
      timestamp: new Date(Date.now() - 30_000).toLocaleTimeString(),
      type: "FEED",
      title: "Venues Synchronized",
      detail: "Velocity & Phoenix orderbook depth aggregated for SOL-PERP.",
      status: "info",
    },
    {
      id: "ev-2",
      timestamp: new Date(Date.now() - 22_000).toLocaleTimeString(),
      type: "POLICY",
      title: "Policy Evaluated",
      detail: "Max leverage ceiling computed based on ecosystem contagion metrics.",
      status: "success",
    },
    {
      id: "ev-3",
      timestamp: new Date(Date.now() - 15_000).toLocaleTimeString(),
      type: "PUBLISH",
      title: "RiskState Verified",
      detail: "Anchor account state read and deserialized from Solana cluster.",
      status: "success",
    },
    {
      id: "ev-4",
      timestamp: new Date(Date.now() - 5_000).toLocaleTimeString(),
      type: "SIMULATION",
      title: "Leverage Gate Active",
      detail: "Contract simulates incoming position orders and enforces max leverage cap.",
      status: "warning",
    },
  ];

  const events = recentEvents.length > 0 ? recentEvents : defaultEvents;
  const filteredEvents = filter === "ALL" ? events : events.filter((e) => e.type === filter);

  return (
    <section className="card event-timeline-card" aria-label="Live event audit timeline">
      <div className="card-title">
        <div>
          <span className="mini-icon blue">📜</span>
          <h2>Event & Audit Timeline</h2>
        </div>
        <div className="timeline-filter-pills">
          {["ALL", "FEED", "POLICY", "PUBLISH", "SIMULATION", "TX"].map((f) => (
            <button
              key={f}
              type="button"
              className={`timeline-filter-btn ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="timeline-items">
        {filteredEvents.map((event) => (
          <div key={event.id} className="timeline-item">
            <span className={`timeline-dot dot-${event.status}`} />
            <div className="timeline-content">
              <div className="timeline-header">
                <strong>{event.title}</strong>
                <span className="timeline-time">{event.timestamp}</span>
              </div>
              <p className="timeline-detail">{event.detail}</p>
              {event.link && (
                <a
                  href={event.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="timeline-link"
                >
                  View on Solana Explorer ↗
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
