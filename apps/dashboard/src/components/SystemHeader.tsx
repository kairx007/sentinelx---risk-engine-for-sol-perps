import { SourceMode } from "@sentinelx/types";

interface SystemHeaderProps {
  mode: SourceMode;
  onModeChange: (mode: SourceMode) => void;
}

export function SystemHeader({ mode, onModeChange }: SystemHeaderProps) {
  return (
    <header className="system-header">
      <div className="system-header__brand">
        <h1 className="system-header__title">SentinelX</h1>
        <span
          className={`badge badge--${mode.toLowerCase()}`}
          aria-label={`Source mode: ${mode}`}
        >
          {mode}
        </span>
      </div>

      <nav className="system-header__nav" aria-label="Source mode selection">
        <button
          className={`btn btn--ghost ${mode === "LIVE" ? "btn--active" : ""}`}
          onClick={() => onModeChange("LIVE")}
          aria-pressed={mode === "LIVE"}
          type="button"
        >
          LIVE
        </button>
        <button
          className={`btn btn--ghost ${mode === "DEMO" ? "btn--active" : ""}`}
          onClick={() => onModeChange("DEMO")}
          aria-pressed={mode === "DEMO"}
          type="button"
        >
          DEMO
        </button>
      </nav>

      <style>{`
        .system-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-md) var(--space-lg);
          background: var(--color-surface);
          border-bottom: 1px solid var(--color-border);
        }

        .system-header__brand {
          display: flex;
          align-items: center;
          gap: var(--space-md);
        }

        .system-header__title {
          font-size: 1.25rem;
          font-weight: 700;
          letter-spacing: -0.03em;
          color: var(--color-text);
        }

        .system-header__nav {
          display: flex;
          gap: var(--space-sm);
        }

        .btn--active {
          background: var(--color-surface-raised);
          border-color: var(--color-border-focus);
          color: var(--color-text);
        }
      `}</style>
    </header>
  );
}
