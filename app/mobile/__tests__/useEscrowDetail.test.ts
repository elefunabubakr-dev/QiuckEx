import { act, renderHook } from "@testing-library/react-native";
import { useEscrowDetail } from "../hooks/useEscrowDetail";
import {
  EscrowApiError,
  fetchEscrowDetail,
  type EscrowDetail,
} from "../services/escrow";

jest.mock("../services/escrow", () => ({
  ...jest.requireActual("../services/escrow"),
  fetchEscrowDetail: jest.fn(),
}));

const mockedFetchEscrowDetail = fetchEscrowDetail as jest.MockedFunction<typeof fetchEscrowDetail>;

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

async function flushPromises() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useEscrowDetail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads escrow detail and exposes loading then success", async () => {
    let resolveFetch!: (detail: EscrowDetail) => void;
    mockedFetchEscrowDetail.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { result } = await renderHook(() => useEscrowDetail("escrow-123"));
    expect(result.current.state.status).toBe("loading");

    await act(async () => {
      resolveFetch(mockEscrow);
    });

    expect(mockedFetchEscrowDetail).toHaveBeenCalledWith("escrow-123");
    expect(result.current.state).toEqual({ status: "success", detail: mockEscrow });
  });

  it("marks a missing escrow distinctly from a request error", async () => {
    mockedFetchEscrowDetail.mockRejectedValueOnce(
      new EscrowApiError("Escrow was not found.", 404, "ESCROW_NOT_FOUND"),
    );

    const { result } = await renderHook(() => useEscrowDetail("missing"));
    await flushPromises();

    expect(result.current.state).toEqual({
      status: "error",
      error: "Escrow was not found.",
      notFound: true,
    });
  });

  it("keeps network and backend failures retryable", async () => {
    mockedFetchEscrowDetail
      .mockRejectedValueOnce(new Error("Network request failed"))
      .mockResolvedValueOnce(mockEscrow);

    const { result } = await renderHook(() => useEscrowDetail("escrow-123"));
    await flushPromises();

    expect(result.current.state).toEqual({
      status: "error",
      error: "Network request failed",
      notFound: false,
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.state).toEqual({ status: "success", detail: mockEscrow });
    expect(mockedFetchEscrowDetail).toHaveBeenCalledTimes(2);
  });

  it("does not request detail when the route has no escrow ID", async () => {
    const { result } = await renderHook(() => useEscrowDetail(undefined));
    await flushPromises();

    expect(mockedFetchEscrowDetail).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({
      status: "error",
      error: "An escrow ID is required.",
      notFound: true,
    });
  });
});
