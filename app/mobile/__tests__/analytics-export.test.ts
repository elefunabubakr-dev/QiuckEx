/**
 * Regression tests for analytics report export (issue #1182).
 *
 * Verifies that exportAnalyticsReport uses a single consistent FileSystem API
 * (the legacy fileSystemCompat pattern) end-to-end and that the temporary
 * export file is reliably cleaned up whether sharing succeeds or fails.
 */

// ---------------------------------------------------------------------------
// Mocks — jest.mock factories are hoisted above imports, so all mock
// functions must be defined inside the factory or accessed via the module.
// ---------------------------------------------------------------------------

// Tracks whether the new SDK-54 File/Paths API was accessed.
let newApiAccessed = false;

jest.mock("expo-file-system", () => {
  class MockFile {
    uri: string;
    constructor(_dir: unknown, _name: string) {
      newApiAccessed = true;
      this.uri = "file:///mock/new-api-uri";
    }
  }
  return {
    __esModule: true,
    writeAsStringAsync: jest.fn(async () => undefined),
    deleteAsync: jest.fn(async () => undefined),
    cacheDirectory: "file:///mock-cache/",
    File: MockFile,
    Paths: new Proxy(
      {},
      {
        get() {
          newApiAccessed = true;
          return "file:///mock-paths-cache";
        },
      },
    ),
    EncodingType: { UTF8: "utf8", Base64: "base64" },
  };
});

jest.mock("expo-sharing", () => ({
  __esModule: true,
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

// Mock quickexApi so ENVIRONMENTS / DEFAULT_ENVIRONMENT are available at runtime.
// (quickexApi imports these from config/environment but does not re-export
// them, so Jest's CommonJS module system returns undefined without this mock.)
jest.mock("../src/services/quickexApi", () => ({
  __esModule: true,
  createClientForEnvironment: jest.fn(),
  ENVIRONMENTS: {
    production: { id: "production", label: "Production", apiUrl: "https://api.test.example", stellarNetwork: "mainnet" },
    staging: { id: "staging", label: "Staging", apiUrl: "https://staging-api.test.example", stellarNetwork: "testnet" },
    testnet: { id: "testnet", label: "Testnet", apiUrl: "https://testnet-api.test.example", stellarNetwork: "testnet" },
    "branch-preview": { id: "branch-preview", label: "Preview", apiUrl: "https://preview-api.test.example", stellarNetwork: "testnet" },
  },
  DEFAULT_ENVIRONMENT: "testnet",
}));

// Mock fetch globally
global.fetch = jest.fn();

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { exportAnalyticsReport, clearAnalyticsCache } from "../src/services/analyticsApi";

const mockedFetch = global.fetch as jest.MockedFunction<typeof fetch>;
const mockWriteAsStringAsync = FileSystem.writeAsStringAsync as jest.MockedFunction<typeof FileSystem.writeAsStringAsync>;
const mockDeleteAsync = FileSystem.deleteAsync as jest.MockedFunction<typeof FileSystem.deleteAsync>;
const mockIsAvailableAsync = Sharing.isAvailableAsync as jest.MockedFunction<typeof Sharing.isAvailableAsync>;
const mockShareAsync = Sharing.shareAsync as jest.MockedFunction<typeof Sharing.shareAsync>;

function mockOkResponse(body: string, contentType = "text/csv") {
  return {
    ok: true,
    status: 200,
    text: async () => body,
    arrayBuffer: async () => {
      const enc = new TextEncoder();
      return enc.encode(body).buffer;
    },
    headers: { get: () => contentType },
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("exportAnalyticsReport — FileSystem API consistency (#1182)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    newApiAccessed = false;
    clearAnalyticsCache();
  });

  it("writes the CSV export using the legacy writeAsStringAsync API", async () => {
    mockedFetch.mockResolvedValue(mockOkResponse("date,volume\n2026-01-01,100"));

    await exportAnalyticsReport("GTEST", "7d", "csv");

    expect(mockWriteAsStringAsync).toHaveBeenCalledTimes(1);
    const callArgs = mockWriteAsStringAsync.mock.calls[0] as [string, string, { encoding: string }];
    // URI must be built from cacheDirectory, not the new File/Paths API
    expect(callArgs[0]).toContain("quickex-analytics-report.csv");
    expect(callArgs[0]).not.toContain("mock/new-api-uri");
    expect(callArgs[1]).toContain("date,volume");
    expect(callArgs[2].encoding).toBe("utf8");
  });

  it("does NOT access the new SDK-54 File class or Paths API", async () => {
    mockedFetch.mockResolvedValue(mockOkResponse("date,volume\n2026-01-01,100"));

    await exportAnalyticsReport("GTEST", "7d", "csv");

    expect(newApiAccessed).toBe(false);
  });

  it("writes the PDF export using base64 encoding via the legacy API", async () => {
    mockedFetch.mockResolvedValue(mockOkResponse("%PDF-1.4 mock", "application/pdf"));

    await exportAnalyticsReport("GTEST", "30d", "pdf");

    expect(mockWriteAsStringAsync).toHaveBeenCalledTimes(1);
    const callArgs = mockWriteAsStringAsync.mock.calls[0] as [string, string, { encoding: string }];
    expect(callArgs[2].encoding).toBe("base64");
  });

  it("cleans up the temp file after sharing succeeds", async () => {
    mockedFetch.mockResolvedValue(mockOkResponse("csv,data\n"));
    mockShareAsync.mockResolvedValue(undefined);

    await exportAnalyticsReport("GTEST", "30d", "csv");

    expect(mockShareAsync).toHaveBeenCalledTimes(1);
    expect(mockDeleteAsync).toHaveBeenCalledTimes(1);
    const deleteArgs = mockDeleteAsync.mock.calls[0] as [string, unknown];
    expect(deleteArgs[0]).toContain("quickex-analytics-report.csv");
  });

  it("cleans up the temp file even when sharing throws", async () => {
    mockedFetch.mockResolvedValue(mockOkResponse("csv,data\n"));
    mockShareAsync.mockRejectedValue(new Error("Share dialog dismissed"));

    await expect(exportAnalyticsReport("GTEST", "30d", "csv")).rejects.toThrow(
      "Share dialog dismissed",
    );

    // The try/finally must still run cleanup
    expect(mockDeleteAsync).toHaveBeenCalledTimes(1);
  });

  it("cleans up the temp file when sharing is not available", async () => {
    mockedFetch.mockResolvedValue(mockOkResponse("csv,data\n"));
    mockIsAvailableAsync.mockResolvedValue(false);

    await expect(exportAnalyticsReport("GTEST", "30d", "csv")).rejects.toThrow(
      "Sharing is not available on this platform",
    );

    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(mockDeleteAsync).toHaveBeenCalledTimes(1);
  });

  it("throws on non-OK HTTP response without writing a file", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(exportAnalyticsReport("GTEST", "30d", "csv")).rejects.toThrow(
      "Export request failed with status 500",
    );

    expect(mockWriteAsStringAsync).not.toHaveBeenCalled();
    expect(mockDeleteAsync).not.toHaveBeenCalled();
  });
});
