import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { PublicKey } from "@solana/web3.js";

export interface WalletAdapter {
  publicKey: PublicKey | null;
  connected: boolean;
  connecting: boolean;
  walletName: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction?: (transaction: any) => Promise<any>;
}

interface WalletContextType {
  wallet: WalletAdapter;
}

const WalletContext = createContext<WalletContextType | null>(null);

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string; toBuffer(): Buffer };
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect(): Promise<void>;
  signTransaction?(transaction: any): Promise<any>;
  on?(event: string, callback: (...args: any[]) => void): void;
  removeListener?(event: string, callback: (...args: any[]) => void): void;
}

declare global {
  interface Window {
    solana?: PhantomProvider;
    phantom?: {
      solana?: PhantomProvider;
    };
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [walletName, setWalletName] = useState<string | null>(null);

  const getProvider = useCallback((): PhantomProvider | null => {
    if (typeof window === "undefined") return null;
    if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
    if (window.solana?.isPhantom) return window.solana;
    if (window.solana) return window.solana;
    return null;
  }, []);

  const connect = useCallback(async () => {
    const provider = getProvider();
    if (!provider) {
      window.open("https://phantom.app/", "_blank");
      return;
    }

    try {
      setConnecting(true);
      const res = await provider.connect();
      if (res?.publicKey) {
        setPublicKey(new PublicKey(res.publicKey.toBase58()));
        setConnected(true);
        setWalletName("Phantom");
      }
    } catch (err) {
      console.error("Wallet connection failed:", err);
    } finally {
      setConnecting(false);
    }
  }, [getProvider]);

  const disconnect = useCallback(async () => {
    const provider = getProvider();
    if (provider) {
      try {
        await provider.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
    setPublicKey(null);
    setConnected(false);
    setWalletName(null);
  }, [getProvider]);

  useEffect(() => {
    const provider = getProvider();
    if (!provider) return;

    // Check eager connection without prompting user
    provider
      .connect({ onlyIfTrusted: true })
      .then((res) => {
        if (res?.publicKey) {
          setPublicKey(new PublicKey(res.publicKey.toBase58()));
          setConnected(true);
          setWalletName("Phantom");
        }
      })
      .catch(() => {
        // Not eagerly connected; expected behavior
      });

    const handleAccountChange = (newPublicKey: { toBase58(): string } | null) => {
      if (newPublicKey) {
        setPublicKey(new PublicKey(newPublicKey.toBase58()));
        setConnected(true);
      } else {
        setPublicKey(null);
        setConnected(false);
      }
    };

    const handleDisconnect = () => {
      setPublicKey(null);
      setConnected(false);
    };

    provider.on?.("accountChanged", handleAccountChange);
    provider.on?.("disconnect", handleDisconnect);

    return () => {
      provider.removeListener?.("accountChanged", handleAccountChange);
      provider.removeListener?.("disconnect", handleDisconnect);
    };
  }, [getProvider]);

  const signTransaction = useCallback(
    async (transaction: any) => {
      const provider = getProvider();
      if (!provider?.signTransaction) {
        throw new Error("Connected wallet does not support signing transactions");
      }
      return provider.signTransaction(transaction);
    },
    [getProvider],
  );

  const walletValue: WalletAdapter = {
    publicKey,
    connected,
    connecting,
    walletName,
    connect,
    disconnect,
    signTransaction,
  };

  return (
    <WalletContext.Provider value={{ wallet: walletValue }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletAdapter {
  const context = useContext(WalletContext);
  if (!context) {
    return {
      publicKey: null,
      connected: false,
      connecting: false,
      walletName: null,
      connect: async () => {},
      disconnect: async () => {},
    };
  }
  return context.wallet;
}
