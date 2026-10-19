// @vitest-environment jsdom
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Settings from "./page";
import { fetchWithAuth } from "@/lib/api";
import { useWallet } from "@/hooks/useWallet";
import type { UseWalletReturn } from "@/hooks/useWallet";

const PUBLIC_KEY = "GBXGQ55JMQ4L2B6E7S8Y9Z0A1B2C3D4E5F6G7H8I7YWR";

vi.mock("@/lib/api", () => ({
  getQuickexApiBase: () => "http://localhost:4000",
  fetchWithAuth: vi.fn(),
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && "username" in opts ? `${key}:${String(opts.username)}` : key,
  }),
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
}));

// Mock LocaleSwitcher to avoid i18n initialization issues
vi.mock("@/components/LocaleSwitcher", () => ({
  LocaleSwitcher: () => <select data-testid="locale-switcher" />,
}));

function mockWallet(publicKey: string | null) {
  (useWallet as unknown as ReturnType<typeof vi.fn> & { mockReturnValue: (value: UseWalletReturn) => void }).mockReturnValue({
    wallet: { connected: Boolean(publicKey), publicKey, network: "testnet" },
    isRestoring: false,
  });
}

/** Resolve `GET /username?publicKey=...` (step 1 of the load sequence). */
function mockOwnedUsernames(usernames: string[]) {
  (fetchWithAuth as unknown as ReturnType<typeof vi.fn> & { mockResolvedValueOnce: (value: unknown) => void }).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      usernames: usernames.map((username, index) => ({
        id: `id-${index}`,
        username,
        created_at: "2026-01-01T00:00:00Z",
      })),
    }),
  });
}

/** Resolve `GET /profile?username=...` (step 2). */
function mockProfile(profile: Record<string, unknown>) {
  (fetchWithAuth as unknown as ReturnType<typeof vi.fn> & { mockResolvedValueOnce: (value: unknown) => void }).mockResolvedValueOnce({
    ok: true,
    json: async () => profile,
  });
}

describe("Settings Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWallet(PUBLIC_KEY);
  });

  it("loads the wallet's most recent username, then that profile, and populates the form", async () => {
    // Oldest first, matching the backend's created_at ordering.
    mockOwnedUsernames(["first_name", "second_name"]);
    mockProfile({
      username: "second_name",
      primaryColor: "#ff0000",
      avatarUrl: "https://example.com/avatar.png",
      bio: "Test bio",
      twitterHandle: "testhandle",
      discordHandle: "test#1234",
      githubHandle: "testgithub",
    });

    render(<Settings />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("https://example.com/avatar.png")).toBeInTheDocument();
    });

    // Step 1 asks which usernames the wallet owns, scoped by public key.
    expect(fetchWithAuth).toHaveBeenCalledWith(
      `http://localhost:4000/username?publicKey=${PUBLIC_KEY}`,
    );
    // Step 2 loads the newest username's profile.
    expect(fetchWithAuth).toHaveBeenCalledWith(
      `http://localhost:4000/profile?username=second_name&publicKey=${PUBLIC_KEY}`,
    );

    expect(screen.getByDisplayValue("#ff0000")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Test bio")).toBeInTheDocument();
    expect(screen.getByDisplayValue("testhandle")).toBeInTheDocument();
    expect(screen.getByDisplayValue("test#1234")).toBeInTheDocument();
    expect(screen.getByDisplayValue("testgithub")).toBeInTheDocument();
  });

  it("null fields from the API render as empty inputs rather than 'null'", async () => {
    mockOwnedUsernames(["first_name"]);
    mockProfile({
      username: "first_name",
      primaryColor: null,
      avatarUrl: null,
      bio: null,
      twitterHandle: null,
      discordHandle: null,
      githubHandle: null,
    });

    render(<Settings />);

    await waitFor(() => {
      expect(
        screen.getAllByText("profileCustomizationDescription:first_name").length,
      ).toBeGreaterThan(0);
    });

    expect(
      screen.getByPlaceholderText("Building the future of payments on Stellar"),
    ).toHaveValue("");
    expect(
      screen.getByPlaceholderText("https://example.com/avatar.jpg"),
    ).toHaveValue("");
    expect(screen.queryByDisplayValue("null")).not.toBeInTheDocument();
  });

  it("offers a selector when the wallet owns more than one username", async () => {
    mockOwnedUsernames(["first_name", "second_name"]);
    mockProfile({ username: "second_name" });

    render(<Settings />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("settingsEditingProfile")).toBeInTheDocument();
    });
  });

  it("tells the user to connect a wallet when none is connected", async () => {
    mockWallet(null);

    render(<Settings />);

    await waitFor(() => {
      expect(screen.getByText("settingsNoWallet")).toBeInTheDocument();
    });
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it("tells the user to claim a username when the wallet owns none", async () => {
    mockOwnedUsernames([]);

    render(<Settings />);

    await waitFor(() => {
      expect(screen.getByText("settingsNoUsername")).toBeInTheDocument();
    });
    // No profile call is attempted without a username to key it by.
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
  });

  it("surfaces the backend's message instead of a generic error when the save fails", async () => {
    mockOwnedUsernames(["first_name"]);
    mockProfile({ username: "first_name" });
    (fetchWithAuth as unknown as ReturnType<typeof vi.fn> & { mockResolvedValueOnce: (value: unknown) => void }).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          fields: { primaryColor: "must be a hex colour in #RRGGBB form" },
        },
      }),
    });

    render(<Settings />);

    await waitFor(() => {
      expect(
        screen.getAllByText("profileCustomizationDescription:first_name").length,
      ).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText("saveChanges")[0]);

    await waitFor(() => {
      expect(
        screen.getAllByText(/primaryColor: must be a hex colour/).length,
      ).toBeGreaterThan(0);
    });
  });

  it("sends the owning public key and the selected username with the save", async () => {
    mockOwnedUsernames(["first_name"]);
    mockProfile({ username: "first_name", bio: "old bio" });
    (fetchWithAuth as unknown as ReturnType<typeof vi.fn> & { mockResolvedValue: (value: unknown) => void }).mockResolvedValue({ ok: true, json: async () => ({}) });

    render(<Settings />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("old bio")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText("saveChanges")[0]);

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        "http://localhost:4000/profile",
        expect.objectContaining({
          method: "PUT",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    const putCall = (fetchWithAuth as unknown as ReturnType<typeof vi.fn> & { mock: { calls: Array<[string, RequestInit | undefined]> } }).mock.calls.find(
      ([, init]: [string, RequestInit | undefined]) => init?.method === "PUT",
    );
    const body = JSON.parse((putCall?.[1] as RequestInit).body as string);

    expect(body).toMatchObject({
      username: "first_name",
      publicKey: PUBLIC_KEY,
      bio: "old bio",
    });
    // username is the locator, never a field to be renamed.
    expect(body.username).toBe("first_name");
  });
});
