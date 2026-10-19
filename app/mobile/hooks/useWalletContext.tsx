import { clearNotificationWalletSigner } from "../services/notification-wallet-auth";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  StellarNetwork,
  WalletContextValue,
  WalletError,
  WalletState,
  WalletType,
} from "../types/wallet";
import {
  clearWalletSession,
  getLastWalletType,
  getWalletSession,
  getSessionInvalidReason,
  isSessionRestorable,
  isSessionEnvironmentMismatch,
  resetInvalidSession,
  saveWalletSession,
  touchSession,
} from "../services/wallet-session";
import {
  deregisterDeviceToken,
  registerDeviceToken,
} from "../services/device-token-registration";
import { useSecurity } from "./use-security";
import { useEnvironment } from "../contexts/EnvironmentContext";

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Testnet public key used by the demo wallet. This is the ONLY hardcoded
 * public key in the codebase and is only ever returned for the `demo`
 * wallet type — non-demo wallets are never silently handed this key.
 */
export const DEMO_PUBLIC_KEY =
  "GAMOSFOKEYHFDGMXIEFEYBUYK3ZMFYN3PFLOTBRXFGBFGRKBKLQSLGLP";

/** Available wallet options shown in the wallet picker UI */
export const SUPPORTED_WALLETS: {
  type: WalletType;
  label: string;
  description: string;
  /**
   * Whether this wallet type is actually functional right now. Non-demo
   * wallets are listed so users can see what's coming, but are disabled in
   * the picker until their real connection/signing SDK is wired up. This
   * prevents the previous behavior of silently faking a connection by
   * handing every wallet type the same hardcoded demo public key.
   */
  available: boolean;
}[] = [
  {
    type: "freighter",
    label: "Freighter",
    description: "Browser extension by Stellar Development Foundation",
    available: false,
  },
  {
    type: "lobstr",
    label: "LOBSTR",
    description: "Mobile-first Stellar wallet",
    available: false,
  },
  {
    type: "xbull",
    label: "xBull",
    description: "Multi-network wallet with Stellar support",
    available: false,
  },
  {
    type: "albedo",
    label: "Albedo",
    description: "Session-based signing — no extension needed",
    available: false,
  },
  {
    type: "demo",
    label: "Demo Wallet",
    description: "Testnet demo account for quick exploration",
    available: true,
  },
];

/**
 * Returns true when a wallet type has a real, functional connection/signing
 * path today. Used by both the wallet picker (to enable/disable options) and
 * `connect()` (to guard against silently faking a connection).
 */
export function isWalletAvailable(type: WalletType): boolean {
  return SUPPORTED_WALLETS.find((w) => w.type === type)?.available ?? false;
}

// ── Error helpers ────────────────────────────────────────────────────────────

function walletError(
  code: WalletError["code"],
  message: string,
  recoverable = true,
): WalletError {
  return { code, message, recoverable };
}

// ── Real wallet-SDK integration point ────────────────────────────────────────
//
// This is the single place where each non-demo wallet's real connection/signing
// SDK is invoked. It is intentionally a thin, explicit seam: until a provider's
// SDK is actually wired up here, `connect()` refuses to hand back a public key
// rather than silently returning the demo key. When a real integration lands
// for a wallet type, flip `available` to `true` in SUPPORTED_WALLETS and
// implement the case below to return the wallet's real public key (and throw
// real SDK error surfaces such as `wallet_locked` / `wrong_network` /
// `signature_rejected`).
async function connectWithWalletSDK(
  walletType: WalletType,
  _network: StellarNetwork,
): Promise<{ publicKey: string }> {
  throw walletError(
    "wallet_not_supported",
    `${SUPPORTED_WALLETS.find((w) => w.type === walletType)?.label ?? walletType} integration is coming soon. Use the Demo Wallet to explore the app for now.`,
    true,
  );
}

// ── Context ──────────────────────────────────────────────────────────────────

const WalletContext = createContext<WalletContextValue | null>(null);

const INITIAL_STATE: WalletState = {
  connected: false,
  publicKey: undefined,
  network: "testnet",
  walletType: undefined,
  connectedAt: undefined,
  error: undefined,
  isRestoring: true, // true until first hydration completes
};

// ── Provider ─────────────────────────────────────────────────────────────────

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [wallet, setWallet] = useState<WalletState>(INITIAL_STATE);
  const { clearSensitiveSessionToken, saveSensitiveSessionToken } =
    useSecurity();
  const { currentId: currentEnvironmentId } = useEnvironment();

  // ── Session restore on mount ─────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        const session = await getWalletSession();

        if (cancelled) return;

        const invalidReason = getSessionInvalidReason(
          session,
          currentEnvironmentId,
        );

        if (session && !invalidReason.invalid) {
          // Legacy sessions created by the old simulated connect flow stored
          // DEMO_PUBLIC_KEY against non-demo wallet types. Don't keep those
          // "connected" — the wallet type isn't actually functional, so clear
          // the session and drop back to the disconnected state (preserving
          // the last wallet type for the picker, which clearly marks
          // unavailable wallets as "coming soon").
          if (
            session.walletType &&
            session.walletType !== "demo" &&
            !isWalletAvailable(session.walletType)
          ) {
            clearNotificationWalletSigner();
            await clearWalletSession();
            await clearSensitiveSessionToken();
            const lastType = await getLastWalletType();
            if (!cancelled) {
              setWallet({
                ...INITIAL_STATE,
                isRestoring: false,
                walletType: lastType ?? undefined,
              });
            }
            return;
          }

          setWallet({
            connected: true,
            publicKey: session.publicKey,
            network: session.network,
            walletType: session.walletType,
            connectedAt: session.connectedAt,
            error: undefined,
            isRestoring: false,
          });

          await touchSession();
        } else if (session && invalidReason.invalid) {
          clearNotificationWalletSigner();
          await clearWalletSession();
          await clearSensitiveSessionToken();

          const lastType = await getLastWalletType();

          if (invalidReason.reason === "environment_mismatch") {
            setWallet({
              ...INITIAL_STATE,
              isRestoring: false,
              walletType: lastType ?? undefined,
              error: walletError(
                "session_environment_mismatch",
                `Your session was created in "${session.environmentId ?? "unknown"}" environment but the app is now running "${currentEnvironmentId}". Please reconnect your wallet.`,
              ),
            });
          } else {
            setWallet({
              ...INITIAL_STATE,
              isRestoring: false,
              walletType: lastType ?? undefined,
              error: walletError(
                "session_expired",
                "Your previous session has expired. Please reconnect your wallet.",
              ),
            });
          }
        } else {
          const lastType = await getLastWalletType();
          setWallet({
            ...INITIAL_STATE,
            isRestoring: false,
            walletType: lastType ?? undefined,
          });
        }
      } catch {
        if (!cancelled) {
          setWallet({ ...INITIAL_STATE, isRestoring: false });
        }
      }
    }

    restore();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEnvironmentId]);

  // ── Periodic session touch (every 15 min while connected) ────────────────

  useEffect(() => {
    if (!wallet.connected) return;

    const interval = setInterval(() => {
      touchSession().catch(() => {});
    }, 15 * 60 * 1000);

    return () => clearInterval(interval);
  }, [wallet.connected]);

  // ── Connect ──────────────────────────────────────────────────────────────

  const connect = useCallback(
    async (walletType: WalletType, network?: StellarNetwork) => {
      setWallet((prev) => ({ ...prev, error: undefined }));

      try {
        const selectedNetwork = network ?? wallet.network ?? "testnet";

        // Only the demo wallet returns a hardcoded (testnet) public key.
        // Every other wallet type MUST go through its real connection/signing
        // SDK. Until a provider's SDK is wired up (see `connectWithWalletSDK`),
        // non-demo wallets throw `wallet_not_supported` rather than silently
        // faking a connection with DEMO_PUBLIC_KEY.
        const publicKey =
          walletType === "demo"
            ? DEMO_PUBLIC_KEY
            : (await connectWithWalletSDK(walletType, selectedNetwork))
                .publicKey;

        const now = Date.now();

        await saveWalletSession(
          {
            publicKey,
            network: selectedNetwork,
            walletType,
            connectedAt: now,
            lastConfirmedAt: new Date(now).toISOString(),
          },
          currentEnvironmentId,
        );

        await saveSensitiveSessionToken(
          `qex_session_${Math.random().toString(36).slice(2, 14)}`,
        );

        setWallet({
          connected: true,
          publicKey,
          network: selectedNetwork,
          walletType,
          connectedAt: now,
          error: undefined,
          isRestoring: false,
        });

        // Register (or refresh) the device push token for the newly
        // connected wallet. This is the authoritative "first grant" moment
        // for the user, so it lives here rather than in the root-layout
        // effect. Failures are queued and reported to crash monitoring by
        // the service itself, so we don't need to await the result.
        void registerDeviceToken({ publicKey }).catch((error) => {
          console.warn(
            "[device-token] register after connect failed:",
            error,
          );
        });
      } catch (err) {
        const error: WalletError =
          err && typeof err === "object" && "code" in err
            ? (err as WalletError)
            : walletError(
                "connection_failed",
                err instanceof Error
                  ? err.message
                  : "Failed to connect wallet. Please try again.",
              );

        setWallet((prev) => ({ ...prev, error }));
      }
    },
    [saveSensitiveSessionToken, wallet.network, currentEnvironmentId],
  );

  // ── Disconnect ───────────────────────────────────────────────────────────

  const disconnect = useCallback(async () => {
    const previousPublicKey = wallet.publicKey;

    // Best-effort deregister before we lose the session. The service will
    // also wipe the local record and queue a retry on failure, so we
    // don't need to await it before continuing the sign-out flow.
    if (previousPublicKey) {
      try {
        await deregisterDeviceToken({ publicKey: previousPublicKey });
      } catch (error) {
        console.warn(
          "[device-token] deregister after disconnect failed:",
          error,
        );
      }
    }

    clearNotificationWalletSigner();
    await clearWalletSession();
    await clearSensitiveSessionToken();

    const lastType = await getLastWalletType();

    setWallet({
      connected: false,
      publicKey: undefined,
      network: wallet.network,
      walletType: lastType ?? undefined,
      connectedAt: undefined,
      error: undefined,
      isRestoring: false,
    });
  }, [clearSensitiveSessionToken, wallet.network, wallet.publicKey]);

  // ── Switch account (within same wallet provider) ─────────────────────────

  const switchAccount = useCallback(
    async (newPublicKey: string) => {
      if (!wallet.connected || !wallet.walletType) return;

      setWallet((prev) => ({ ...prev, error: undefined }));

      try {
        const now = Date.now();

        await saveWalletSession(
          {
            publicKey: newPublicKey,
            network: wallet.network,
            walletType: wallet.walletType!,
            connectedAt: now,
            lastConfirmedAt: new Date(now).toISOString(),
          },
          currentEnvironmentId,
        );

        setWallet((prev) => ({
          ...prev,
          publicKey: newPublicKey,
          connectedAt: now,
          error: undefined,
        }));

        // Re-register the device token against the new public key so the
        // old wallet stops receiving notifications for the new account.
        void registerDeviceToken({ publicKey: newPublicKey, force: true }).catch(
          (error) => {
            console.warn(
              "[device-token] register after switchAccount failed:",
              error,
            );
          },
        );
      } catch (err) {
        const error: WalletError = walletError(
          "connection_failed",
          err instanceof Error
            ? err.message
            : "Failed to switch account. Please try again.",
        );

        setWallet((prev) => ({ ...prev, error }));
      }
    },
    [wallet.connected, wallet.walletType, wallet.network, currentEnvironmentId],
  );

  // ── Switch network ───────────────────────────────────────────────────────

  const switchNetwork = useCallback((network: StellarNetwork) => {
    setWallet((prev) => ({ ...prev, network }));
  }, []);

  // ── Clear error ──────────────────────────────────────────────────────────

  const clearError = useCallback(() => {
    setWallet((prev) => ({ ...prev, error: undefined }));
  }, []);

  // ── Context value ────────────────────────────────────────────────────────

  const value = useMemo<WalletContextValue>(
    () => ({
      wallet,
      connect,
      disconnect,
      switchAccount,
      switchNetwork,
      clearError,
    }),
    [wallet, connect, disconnect, switchAccount, switchNetwork, clearError],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
};

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWalletContext must be used within a WalletProvider");
  }
  return ctx;
}
