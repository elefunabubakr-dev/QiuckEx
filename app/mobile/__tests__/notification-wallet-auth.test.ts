import {
  clearNotificationWalletSigner,
  createNotificationProofHeaders,
  NotificationWalletAuthError,
  setNotificationWalletSigner,
} from "../services/notification-wallet-auth";

const publicKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const url = `https://api.example.com/notifications/preferences/${publicKey}`;
const body = {
  channel: "push",
  pushToken: "ExponentPushToken[token]",
  enabled: true,
};
const signature = "A".repeat(86) + "==";
let signMessage: jest.Mock;
let fetchMock: jest.Mock;
function challenge(overrides: Record<string, unknown> = {}) {
  const expiresAt = Date.now() + 120_000;
  const nonce = "a".repeat(64);
  return {
    challenge: nonce,
    expiresAt,
    message: JSON.stringify({
      domain: "QuickEx wallet request v1",
      publicKey,
      method: "PUT",
      path: new URL(url).pathname,
      body,
      nonce,
      expiresAt,
      ...overrides,
    }),
  };
}
beforeEach(() => {
  signMessage = jest.fn().mockResolvedValue(signature);
  setNotificationWalletSigner({ publicKey, signMessage });
  fetchMock = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => challenge() });
  global.fetch = fetchMock;
});
afterEach(() => clearNotificationWalletSigner());

describe("notification wallet proof transport", () => {
  it("requests a body-bound challenge and forwards the connected wallet signature", async () => {
    const headers = await createNotificationProofHeaders({
      url,
      publicKey,
      method: "PUT",
      body,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${url}/challenge`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ method: "PUT", body }),
      }),
    );
    expect(JSON.parse(signMessage.mock.calls[0][0])).toMatchObject({
      publicKey,
      body,
      method: "PUT",
    });
    expect(headers).toEqual({
      "X-Wallet-Public-Key": publicKey,
      "X-Wallet-Challenge": "a".repeat(64),
      "X-Wallet-Signature": signature,
    });
  });
  it("gets a fresh proof for each call instead of caching signatures", async () => {
    await createNotificationProofHeaders({
      url,
      publicKey,
      method: "PUT",
      body,
    });
    await createNotificationProofHeaders({
      url,
      publicKey,
      method: "PUT",
      body,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signMessage).toHaveBeenCalledTimes(2);
  });
  it("authenticates deregistration against the channel-specific path", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () =>
        challenge({
          method: "DELETE",
          path: `${new URL(url).pathname}/push`,
          body: null,
        }),
    });
    await createNotificationProofHeaders({
      url: `${url}/push`,
      publicKey,
      method: "DELETE",
      channel: "push",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${url}/challenge`,
      expect.objectContaining({
        body: JSON.stringify({ method: "DELETE", channel: "push" }),
      }),
    );
  });
  it("fails closed without a signer, including restored/demo sessions", async () => {
    clearNotificationWalletSigner();
    await expect(
      createNotificationProofHeaders({ url, publicKey, method: "PUT", body }),
    ).rejects.toBeInstanceOf(NotificationWalletAuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects a signer for a different wallet before any network request", async () => {
    setNotificationWalletSigner({ publicKey: "another-wallet", signMessage });
    await expect(
      createNotificationProofHeaders({ url, publicKey, method: "PUT", body }),
    ).rejects.toBeInstanceOf(NotificationWalletAuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    { domain: "evil" },
    { publicKey: "another-wallet" },
    { method: "DELETE" },
    { path: "/evil" },
    { body: { ...body, pushToken: "attacker" } },
    { nonce: "b".repeat(64) },
    { expiresAt: 0 },
  ])("refuses to sign a substituted challenge: %j", async (overrides) => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => challenge(overrides),
    });
    await expect(
      createNotificationProofHeaders({ url, publicKey, method: "PUT", body }),
    ).rejects.toBeInstanceOf(NotificationWalletAuthError);
    expect(signMessage).not.toHaveBeenCalled();
  });
  it.each([null, { message: "invalid json" }, { message: "null" }])(
    "rejects malformed challenges before signing",
    async (value) => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => value });
      await expect(
        createNotificationProofHeaders({ url, publicKey, method: "PUT", body }),
      ).rejects.toBeInstanceOf(NotificationWalletAuthError);
      expect(signMessage).not.toHaveBeenCalled();
    },
  );
  it("does not return a proof after the wallet disconnects during signing", async () => {
    signMessage.mockImplementation(async () => {
      clearNotificationWalletSigner();
      return signature;
    });
    await expect(
      createNotificationProofHeaders({ url, publicKey, method: "PUT", body }),
    ).rejects.toBeInstanceOf(NotificationWalletAuthError);
  });
  it("treats a rejected signature as a permanent authentication error", async () => {
    signMessage.mockRejectedValue(new Error("User cancelled"));
    await expect(
      createNotificationProofHeaders({ url, publicKey, method: "PUT", body }),
    ).rejects.toBeInstanceOf(NotificationWalletAuthError);
  });
  it("rejects malformed signature encodings", async () => {
    signMessage.mockResolvedValue("not-a-signature");
    await expect(
      createNotificationProofHeaders({ url, publicKey, method: "PUT", body }),
    ).rejects.toBeInstanceOf(NotificationWalletAuthError);
  });
  it("classifies unauthorized challenges as non-retryable", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    await expect(
      createNotificationProofHeaders({ url, publicKey, method: "PUT", body }),
    ).rejects.toBeInstanceOf(NotificationWalletAuthError);
    expect(signMessage).not.toHaveBeenCalled();
  });
});
