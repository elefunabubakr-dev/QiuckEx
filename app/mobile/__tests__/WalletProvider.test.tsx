/**
 * Integration tests for the WalletContext / WalletProvider.
 *
 * Covers: connect, disconnect, switchAccount, switchNetwork, session restore,
 * and the real error surface for non-demo wallet types (`wallet_not_supported`).
 *
 * The previous version of this suite injected fake `wallet_locked` /
 * `wrong_network` / `signature_rejected` errors via `Math.random()` and
 * asserted that every non-demo wallet connected to a hardcoded demo key.
 * That behavior is gone: non-demo wallets now go through `connectWithWalletSDK`
 * and, until their real SDK is wired up, surface a `wallet_not_supported`
 * error instead of silently faking a connection. Only the demo wallet
 * returns `DEMO_PUBLIC_KEY`.
 */
import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text } from "react-native";

import {
  DEMO_PUBLIC_KEY,
  SUPPORTED_WALLETS,
  WalletProvider,
  isWalletAvailable,
  useWalletContext,
} from "../hooks/useWalletContext";
import type { WalletContextValue, WalletType } from "../types/wallet";

// The jest-expo preset pays a one-time module-load cost on the first render
// of each suite (expo/native module stubs). Give the suite generous headroom
// so the first test isn't falsely flagged as timing out.
jest.setTimeout(30000);

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("../services/wallet-session", () => {
  let storedSession: any = null;
  let lastWalletType: string | null = null;

  return {
    getWalletSession: jest.fn(async () => storedSession),
    saveWalletSession: jest.fn(async (session: any, environmentId?: string) => {
      storedSession = { ...session, environmentId };
      lastWalletType = session.walletType;
    }),
    clearWalletSession: jest.fn(async () => {
      storedSession = null;
    }),
    isSessionRestorable: jest.fn((session: any) => {
      if (!session) return false;
      const age = Date.now() - session.connectedAt;
      return age < 7 * 24 * 60 * 60 * 1000;
    }),
    getSessionInvalidReason: jest.fn((session: any, currentEnvironmentId?: string) => {
      if (!session) return { invalid: true, reason: "corrupted" };
      const age = Date.now() - session.connectedAt;
      if (age > 7 * 24 * 60 * 60 * 1000) return { invalid: true, reason: "expired" };
      if (
        currentEnvironmentId &&
        session.environmentId &&
        session.environmentId !== currentEnvironmentId
      ) {
        return { invalid: true, reason: "environment_mismatch" };
      }
      return { invalid: false };
    }),
    isSessionEnvironmentMismatch: jest.fn((session: any, envId: string) => {
      return !!session.environmentId && session.environmentId !== envId;
    }),
    resetInvalidSession: jest.fn(async (currentEnvironmentId?: string) => {
      if (!storedSession) return { reason: "corrupted" };
      const age = Date.now() - storedSession.connectedAt;
      if (age > 7 * 24 * 60 * 60 * 1000) {
        storedSession = null;
        return { reason: "expired", session: storedSession };
      }
      if (
        currentEnvironmentId &&
        storedSession.environmentId &&
        storedSession.environmentId !== currentEnvironmentId
      ) {
        const session = { ...storedSession };
        storedSession = null;
        return { reason: "environment_mismatch", session };
      }
      return { reason: "none", session: storedSession };
    }),
    touchSession: jest.fn(async () => {}),
    getLastWalletType: jest.fn(async () => lastWalletType),
  };
});

jest.mock("../contexts/EnvironmentContext", () => ({
  useEnvironment: () => ({
    currentId: "production",
    current: { id: "production", label: "Production", stellarNetwork: "mainnet" },
    available: [],
    isReady: true,
    switchEnvironment: jest.fn(async () => {}),
    resetToDefault: jest.fn(async () => {}),
    metadata: null,
    compatibility: null,
    isFetchingMetadata: false,
    fetchMetadata: jest.fn(async () => {}),
  }),
}));

// Device-token registration is exercised by the lifecycle service; in this
// unit-test we want connect/disconnect to remain synchronous and free of
// the network, so the whole module is stubbed out.
jest.mock("../services/device-token-registration", () => ({
  registerDeviceToken: jest.fn(async () => ({ status: "registered", token: "mock-token", alreadyRegistered: false })),
  deregisterDeviceToken: jest.fn(async () => ({ status: "deregistered" })),
  reconcileInstallation: jest.fn(async () => ({ status: "unchanged" })),
  handlePermissionRevoked: jest.fn(async () => undefined),
  getPermissionStatus: jest.fn(async () => "granted"),
  flushDeviceTokenQueue: jest.fn(async () => undefined),
}));

jest.mock("../hooks/use-security", () => ({
  useSecurity: () => ({
    saveSensitiveSessionToken: jest.fn(async () => {}),
    clearSensitiveSessionToken: jest.fn(async () => {}),
    getSensitiveSessionToken: jest.fn(async () => null),
    authenticateForSensitiveAction: jest.fn(async () => true),
    isReady: true,
    isAppLocked: false,
    isBiometricAvailable: true,
    hasPinConfigured: false,
    settings: { biometricLockEnabled: false },
    setBiometricLockEnabled: jest.fn(async () => ({ ok: true })),
    savePin: jest.fn(async () => ({ ok: true })),
    unlockApp: jest.fn(async () => true),
  }),
  SecurityProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ── Test harness ─────────────────────────────────────────────────────────────

let capturedWallet: WalletContextValue | null = null;

function Harness() {
  capturedWallet = useWalletContext();
  return <Text>test</Text>;
}

function renderWithProvider() {
  capturedWallet = null;
  return renderer.create(
    <WalletProvider>
      <Harness />
    </WalletProvider>,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("WalletProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    const sessionMod = jest.requireMock("../services/wallet-session");
    sessionMod.getWalletSession.mockResolvedValue(null);
    sessionMod.getLastWalletType.mockResolvedValue(null);
  });

  describe("wallet availability metadata", () => {
    it("marks only the demo wallet as available today", () => {
      const available = SUPPORTED_WALLETS.filter((w) => w.available);
      expect(available.map((w) => w.type)).toEqual(["demo"]);
    });

    it("isWalletAvailable returns true only for demo", () => {
      expect(isWalletAvailable("demo")).toBe(true);
      expect(isWalletAvailable("freighter")).toBe(false);
      expect(isWalletAvailable("lobstr")).toBe(false);
      expect(isWalletAvailable("xbull")).toBe(false);
      expect(isWalletAvailable("albedo")).toBe(false);
    });
  });

  describe("initial state / session restore", () => {
    it("starts restoring and then settles to disconnected", async () => {
      const tree = renderWithProvider();

      // Wait for hydration
      await act(async () => {});

      expect(capturedWallet).not.toBeNull();
      expect(capturedWallet!.wallet.connected).toBe(false);
      expect(capturedWallet!.wallet.isRestoring).toBe(false);
      expect(capturedWallet!.wallet.publicKey).toBeUndefined();

      tree.unmount();
    });

    it("restores a valid saved demo session on mount", async () => {
      const sessionMod = jest.requireMock("../services/wallet-session");
      const mockSession = {
        publicKey: "GARESTOREDEMOCKEY000000000000000000000000000",
        network: "testnet",
        walletType: "demo",
        connectedAt: Date.now(),
        lastConfirmedAt: new Date().toISOString(),
      };
      sessionMod.getWalletSession.mockResolvedValue(mockSession);
      sessionMod.isSessionRestorable.mockReturnValue(true);

      const tree = renderWithProvider();

      await act(async () => {});

      expect(capturedWallet!.wallet.connected).toBe(true);
      expect(capturedWallet!.wallet.publicKey).toBe(mockSession.publicKey);
      expect(capturedWallet!.wallet.walletType).toBe("demo");
      expect(capturedWallet!.wallet.network).toBe("testnet");

      tree.unmount();
    });

    it("does not restore a session for a non-demo wallet type that is not functional yet", async () => {
      // A legacy session created by the old simulated connect flow stored the
      // demo public key against a non-demo walletType. Such a session must not
      // be silently kept "connected" — it should be cleared.
      const sessionMod = jest.requireMock("../services/wallet-session");
      const legacyFreighterSession = {
        publicKey: DEMO_PUBLIC_KEY,
        network: "testnet",
        walletType: "freighter",
        connectedAt: Date.now(),
        lastConfirmedAt: new Date().toISOString(),
      };
      sessionMod.getWalletSession.mockResolvedValue(legacyFreighterSession);
      sessionMod.isSessionRestorable.mockReturnValue(true);

      const tree = renderWithProvider();

      await act(async () => {});

      expect(sessionMod.clearWalletSession).toHaveBeenCalled();
      expect(capturedWallet!.wallet.connected).toBe(false);
      expect(capturedWallet!.wallet.publicKey).toBeUndefined();

      tree.unmount();
    });

    it("does not restore an expired session", async () => {
      const sessionMod = jest.requireMock("../services/wallet-session");
      const expiredSession = {
        publicKey: "GAEXPIREDMOCKEY0000000000000000000000000000000",
        network: "testnet",
        walletType: "demo",
        connectedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
        lastConfirmedAt: new Date(
          Date.now() - 8 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      };
      sessionMod.getWalletSession.mockResolvedValue(expiredSession);

      const tree = renderWithProvider();

      await act(async () => {});

      expect(capturedWallet!.wallet.connected).toBe(false);
      expect(capturedWallet!.wallet.error?.code).toBe("session_expired");

      tree.unmount();
    });

    it("does not restore a session from a different environment", async () => {
      const sessionMod = jest.requireMock("../services/wallet-session");
      const mismatchSession = {
        publicKey: "GADIFFENVKEY00000000000000000000000000000000000",
        network: "testnet",
        walletType: "demo",
        connectedAt: Date.now(),
        lastConfirmedAt: new Date().toISOString(),
        environmentId: "staging",
      };
      sessionMod.getWalletSession.mockResolvedValue(mismatchSession);

      const tree = renderWithProvider();

      await act(async () => {});

      expect(capturedWallet!.wallet.connected).toBe(false);
      expect(capturedWallet!.wallet.error?.code).toBe(
        "session_environment_mismatch",
      );
      expect(capturedWallet!.wallet.error?.message).toContain("staging");
      expect(capturedWallet!.wallet.error?.message).toContain("production");

      tree.unmount();
    });

    it("clears old session and resets to disconnected state when environment mismatches", async () => {
      const sessionMod = jest.requireMock("../services/wallet-session");
      const mismatchSession = {
        publicKey: "GAENVSWITCHKEY00000000000000000000000000000000",
        network: "mainnet",
        walletType: "demo",
        connectedAt: Date.now(),
        lastConfirmedAt: new Date().toISOString(),
        environmentId: "branch-preview",
      };
      sessionMod.getWalletSession.mockResolvedValue(mismatchSession);

      const tree = renderWithProvider();

      await act(async () => {});

      expect(sessionMod.clearWalletSession).toHaveBeenCalled();
      expect(capturedWallet!.wallet.connected).toBe(false);
      expect(capturedWallet!.wallet.publicKey).toBeUndefined();

      tree.unmount();
    });

    it("does not restore a corrupted session (null session)", async () => {
      const sessionMod = jest.requireMock("../services/wallet-session");
      sessionMod.getWalletSession.mockResolvedValue(null);

      const tree = renderWithProvider();

      await act(async () => {});

      expect(capturedWallet!.wallet.connected).toBe(false);
      expect(capturedWallet!.wallet.error).toBeUndefined();
      expect(capturedWallet!.wallet.isRestoring).toBe(false);

      tree.unmount();
    });
  });

  describe("connect", () => {
    it("connects with the demo wallet type and returns DEMO_PUBLIC_KEY", async () => {
      const tree = renderWithProvider();

      await act(async () => {});

      await act(async () => {
        await capturedWallet!.connect("demo", "testnet");
      });

      expect(capturedWallet!.wallet.connected).toBe(true);
      expect(capturedWallet!.wallet.walletType).toBe("demo");
      expect(capturedWallet!.wallet.publicKey).toBe(DEMO_PUBLIC_KEY);
      expect(capturedWallet!.wallet.error).toBeUndefined();

      tree.unmount();
    });

    it("saves session on connect", async () => {
      const sessionMod = jest.requireMock("../services/wallet-session");
      const tree = renderWithProvider();

      await act(async () => {});

      await act(async () => {
        await capturedWallet!.connect("demo", "testnet");
      });

      expect(sessionMod.saveWalletSession).toHaveBeenCalledTimes(1);
      const savedSession = sessionMod.saveWalletSession.mock.calls[0][0];
      expect(savedSession.walletType).toBe("demo");
      expect(savedSession.publicKey).toBe(DEMO_PUBLIC_KEY);
      expect(savedSession.network).toBe("testnet");

      tree.unmount();
    });

    it("saves environmentId on connect", async () => {
      const sessionMod = jest.requireMock("../services/wallet-session");
      const tree = renderWithProvider();

      await act(async () => {});

      await act(async () => {
        await capturedWallet!.connect("demo", "testnet");
      });

      expect(sessionMod.saveWalletSession).toHaveBeenCalled();
      const calls = sessionMod.saveWalletSession.mock.calls;
      const lastCall = calls[calls.length - 1];
      const environmentId = lastCall[1];
      expect(environmentId).toBe("production");

      tree.unmount();
    });

    it.each([
      ["freighter"],
      ["lobstr"],
      ["xbull"],
      ["albedo"],
    ] as WalletType[][])(
      "surfaces wallet_not_supported (not a faked demo key) for %s",
      async (walletType) => {
        const sessionMod = jest.requireMock("../services/wallet-session");
        const tree = renderWithProvider();

        await act(async () => {});

        await act(async () => {
          await capturedWallet!.connect(walletType, "testnet");
        });

        expect(capturedWallet!.wallet.connected).toBe(false);
        expect(capturedWallet!.wallet.publicKey).toBeUndefined();
        expect(capturedWallet!.wallet.error?.code).toBe("wallet_not_supported");
        expect(capturedWallet!.wallet.error?.recoverable).toBe(true);
        // Crucially: a non-demo connect must never persist a session with the
        // demo public key.
        expect(sessionMod.saveWalletSession).not.toHaveBeenCalled();

        tree.unmount();
      },
    );

    it("does not inject Math.random-based fake errors", async () => {
      // Guard against regressing the old behavior: the connect path must not
      // reach for Math.random() to fabricate wallet_locked / wrong_network /
      // signature_rejected for non-demo wallets.
      const randomSpy = jest.spyOn(Math, "random");

      const tree = renderWithProvider();

      await act(async () => {});

      await act(async () => {
        await capturedWallet!.connect("freighter", "testnet");
      });

      expect(randomSpy).not.toHaveBeenCalled();
      expect(capturedWallet!.wallet.error?.code).toBe("wallet_not_supported");

      randomSpy.mockRestore();
      tree.unmount();
    });
  });

  describe("disconnect", () => {
    it("disconnects a connected wallet", async () => {
      const sessionMod = jest.requireMock("../services/wallet-session");
      const tree = renderWithProvider();

      await act(async () => {});

      // Connect first
      await act(async () => {
        await capturedWallet!.connect("demo", "testnet");
      });

      expect(capturedWallet!.wallet.connected).toBe(true);

      // Now disconnect
      await act(async () => {
        await capturedWallet!.disconnect();
      });

      expect(capturedWallet!.wallet.connected).toBe(false);
      expect(capturedWallet!.wallet.publicKey).toBeUndefined();
      expect(sessionMod.clearWalletSession).toHaveBeenCalled();

      tree.unmount();
    });

    it("preserves network after disconnect", async () => {
      const tree = renderWithProvider();

      await act(async () => {});

      await act(async () => {
        await capturedWallet!.connect("demo", "mainnet");
      });

      await act(async () => {
        await capturedWallet!.disconnect();
      });

      expect(capturedWallet!.wallet.network).toBe("mainnet");

      tree.unmount();
    });
  });

  describe("switchAccount", () => {
    it("switches the active public key", async () => {
      const sessionMod = jest.requireMock("../services/wallet-session");
      const tree = renderWithProvider();

      await act(async () => {});

      await act(async () => {
        await capturedWallet!.connect("demo", "testnet");
      });

      const newKey =
        "GANEWACCOUNTKEY00000000000000000000000000000000000";

      await act(async () => {
        await capturedWallet!.switchAccount(newKey);
      });

      expect(capturedWallet!.wallet.publicKey).toBe(newKey);

      // Should save the updated session
      const lastCall =
        sessionMod.saveWalletSession.mock.calls[
          sessionMod.saveWalletSession.mock.calls.length - 1
        ];
      expect(lastCall[0].publicKey).toBe(newKey);

      tree.unmount();
    });

    it("does nothing when not connected", async () => {
      const tree = renderWithProvider();

      await act(async () => {});

      await act(async () => {
        await capturedWallet!.switchAccount("GASOMEKEY");
      });

      expect(capturedWallet!.wallet.connected).toBe(false);

      tree.unmount();
    });
  });

  describe("switchNetwork", () => {
    it("switches the network", async () => {
      const tree = renderWithProvider();

      await act(async () => {});

      expect(capturedWallet!.wallet.network).toBe("testnet");

      act(() => {
        capturedWallet!.switchNetwork("mainnet");
      });

      expect(capturedWallet!.wallet.network).toBe("mainnet");

      tree.unmount();
    });

    it("recovers from mismatch by switching network back to testnet", async () => {
      const tree = renderWithProvider();

      await act(async () => {});

      // Connect wallet on mainnet (mismatch with expected testnet)
      await act(async () => {
        await capturedWallet!.connect("demo", "mainnet");
      });

      expect(capturedWallet!.wallet.connected).toBe(true);
      expect(capturedWallet!.wallet.network).toBe("mainnet");

      // Recover by switching to testnet
      act(() => {
        capturedWallet!.switchNetwork("testnet");
      });

      expect(capturedWallet!.wallet.network).toBe("testnet");

      tree.unmount();
    });

    it("correctly toggles between testnet and mainnet", async () => {
      const tree = renderWithProvider();

      await act(async () => {});

      // Connected wallets can switch network back and forth
      await act(async () => {
        await capturedWallet!.connect("demo", "testnet");
      });

      expect(capturedWallet!.wallet.network).toBe("testnet");

      act(() => capturedWallet!.switchNetwork("mainnet"));
      expect(capturedWallet!.wallet.network).toBe("mainnet");

      act(() => capturedWallet!.switchNetwork("testnet"));
      expect(capturedWallet!.wallet.network).toBe("testnet");

      tree.unmount();
    });
  });

  describe("clearError", () => {
    it("clears the current error", async () => {
      // A non-demo connect surfaces a real error (wallet_not_supported)
      // instead of a Math.random()-injected one.
      const tree = renderWithProvider();

      await act(async () => {});

      await act(async () => {
        await capturedWallet!.connect("freighter", "testnet");
      });

      expect(capturedWallet!.wallet.error).toBeDefined();
      expect(capturedWallet!.wallet.error?.code).toBe("wallet_not_supported");

      act(() => {
        capturedWallet!.clearError();
      });

      expect(capturedWallet!.wallet.error).toBeUndefined();

      tree.unmount();
    });
  });
});
