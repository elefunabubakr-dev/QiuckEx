import {
  EscrowApiError,
  fetchEscrowDetail,
  formatEscrowAmount,
  getEscrowStatus,
  isEscrowNotFoundError,
  type EscrowDetail,
} from "../services/escrow";

jest.mock("../src/config/build", () => ({
  API_URL: "http://localhost:4000",
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockEscrow: EscrowDetail = {
  id: "escrow-123",
  depositor: "GDEPOSITOR12345678901234567890123456789012345678901234567890",
  beneficiary: "GBENEFICIARY123456789012345678901234567890123456789012345678",
  amount: "12500000",
  assetCode: "USDC",
  released: false,
  refunded: false,
  expiryLedger: 123456,
  expired: false,
};

describe("escrow service", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("fetches escrow detail from the configured local backend endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockEscrow,
    });

    const detail = await fetchEscrowDetail(" escrow/123 ");

    expect(detail).toEqual(mockEscrow);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:4000/v1/contracts/views/escrow/escrow%2F123",
      { headers: { Accept: "application/json" } },
    );
  });

  it("preserves backend error details for a not-found response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        error: {
          code: "ESCROW_NOT_FOUND",
          message: "Escrow was not found or has expired.",
        },
      }),
    });

    await expect(fetchEscrowDetail("missing-escrow")).rejects.toMatchObject({
      name: "EscrowApiError",
      status: 404,
      code: "ESCROW_NOT_FOUND",
      message: "Escrow was not found or has expired.",
    });
  });

  it("reports network errors with a retry-friendly message", async () => {
    mockFetch.mockRejectedValueOnce(new Error("connection refused"));

    await expect(fetchEscrowDetail("escrow-123")).rejects.toThrow(
      "Network request failed. Check your connection and try again.",
    );
  });

  it("does not classify backend configuration errors as a missing escrow", () => {
    const error = new EscrowApiError(
      "QUICKEX_CONTRACT_ID is not configured.",
      404,
      "CONTRACT_NOT_CONFIGURED",
    );

    expect(isEscrowNotFoundError(error)).toBe(false);
    expect(isEscrowNotFoundError(new EscrowApiError("Escrow not found.", 404, "ESCROW_NOT_FOUND"))).toBe(true);
  });

  it("formats integer Stellar base units as human-readable token amounts", () => {
    expect(formatEscrowAmount("12500000")).toBe("1.25");
    expect(formatEscrowAmount("1234567890123")).toBe("123,456.7890123");
    expect(formatEscrowAmount("-25000000")).toBe("-2.5");
  });

  it("keeps decimal amounts human-readable and derives state from backend fields", () => {
    expect(formatEscrowAmount("100.5000000")).toBe("100.5");
    expect(getEscrowStatus(mockEscrow)).toBe("open");
    expect(getEscrowStatus({ ...mockEscrow, released: true })).toBe("released");
    expect(getEscrowStatus({ ...mockEscrow, status: "Disputed" })).toBe("disputed");
    expect(getEscrowStatus({ ...mockEscrow, refunded: true })).toBe("refunded");
  });
});
