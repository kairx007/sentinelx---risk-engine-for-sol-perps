import { useWallet } from "../solana/wallet";

export function WalletConnect() {
  const wallet = useWallet();

  const truncate = (key: string) => `${key.slice(0, 4)}…${key.slice(-4)}`;

  return (
    <div className="wallet-connect-wrapper">
      {wallet.connected && wallet.publicKey ? (
        <div className="wallet-connected-pill">
          <span className="live-dot" />
          <span className="wallet-name">{wallet.walletName ?? "Wallet"}</span>
          <span className="wallet-address" title={wallet.publicKey.toBase58()}>
            {truncate(wallet.publicKey.toBase58())}
          </span>
          <button
            type="button"
            className="wallet-disconnect-btn"
            onClick={wallet.disconnect}
            title="Disconnect wallet"
            aria-label="Disconnect wallet"
          >
            ×
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="button button-primary wallet-connect-btn"
          onClick={wallet.connect}
          disabled={wallet.connecting}
        >
          {wallet.connecting ? "Connecting…" : "Connect Wallet"}
        </button>
      )}
    </div>
  );
}
