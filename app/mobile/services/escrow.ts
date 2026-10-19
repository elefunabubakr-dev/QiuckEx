import { API_URL } from "../src/config/build";

const API_BASE_URL = API_URL.replace(/\/+$/, "");

export type EscrowTimestamp = string | number | null;

/**
 * Public escrow summary returned by GET /v1/contracts/views/escrow/:id.
 * Timestamp fields are optional because the currently deployed summary shape
 * only guarantees the expiry ledger, while newer backend versions may expose
 * the underlying contract timestamps as well.
 */
export interface EscrowDetail {
  id: string;
  depositor: string;
  beneficiary: string;
  /** Integer values from the Soroban contract are token base units (stroops). */
  amount: string | number;
  assetCode: string;
  released: boolean;
  refunded: boolean;
  expiryLedger: number | string | null;
  expired: boolean;
  /** Present on backends that expose the contract's richer lifecycle state. */
  status?: string | null;
  createdAt?: EscrowTimestamp;
  created_at?: EscrowTimestamp;
  updatedAt?: EscrowTimestamp;
  updated_at?: EscrowTimestamp;
  expiresAt?: EscrowTimestamp;
  expires_at?: EscrowTimestamp;
  releasedAt?: EscrowTimestamp;
  released_at?: EscrowTimestamp;
  refundedAt?: EscrowTimestamp;
  refunded_at?: EscrowTimestamp;
}

export class EscrowApiError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "EscrowApiError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toMessage(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) {
    const messages = value.filter((item): item is string => typeof item === "string");
    return messages.length > 0 ? messages.join(" ") : undefined;
  }
  return undefined;
}

async function parseApiError(response: Response): Promise<EscrowApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // A non-JSON gateway response should still include the HTTP status.
  }

  const outer = isRecord(body) ? body : undefined;
  const nestedError = outer && isRecord(outer.error) ? outer.error : undefined;
  const message =
    toMessage(nestedError?.message) ??
    toMessage(outer?.message) ??
    toMessage(outer?.error) ??
    `Server error (${response.status})`;
  const codeValue = nestedError?.code ?? outer?.code ?? outer?.errorCode;
  const code = typeof codeValue === "string" ? codeValue : undefined;

  return new EscrowApiError(message, response.status, code);
}

/** Fetch the current on-chain summary for an escrow from the backend. */
export async function fetchEscrowDetail(escrowId: string): Promise<EscrowDetail> {
  const id = escrowId.trim();
  if (!id) {
    throw new EscrowApiError("An escrow ID is required.", 400, "INVALID_ESCROW_ID");
  }

  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}/v1/contracts/views/escrow/${encodeURIComponent(id)}`,
      { headers: { Accept: "application/json" } },
    );
  } catch {
    throw new EscrowApiError(
      "Network request failed. Check your connection and try again.",
    );
  }

  if (!response.ok) {
    throw await parseApiError(response);
  }

  try {
    return (await response.json()) as EscrowDetail;
  } catch {
    throw new EscrowApiError("The server returned an invalid escrow response.");
  }
}

/** Treat backend 404s and explicit escrow-not-found errors as a not-found state. */
export function isEscrowNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code = error instanceof EscrowApiError ? error.code?.toUpperCase() : undefined;

  if (code && code !== "NOT_FOUND" && !code.includes("NOT_FOUND")) {
    return /\bnot found\b/i.test(message);
  }

  if (error instanceof EscrowApiError && error.status === 404) return true;
  return /\bnot found\b/i.test(message) || /\b404\b/.test(message);
}

export type EscrowStatus =
  | "open"
  | "disputed"
  | "released"
  | "refunded"
  | "cancelled"
  | "expired"
  | "unknown";

/** Derive a stable display status from fields available in the escrow view. */
export function getEscrowStatus(detail: EscrowDetail): EscrowStatus {
  const rawStatus = (detail.status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (detail.released || ["released", "withdrawn", "spent", "settled", "completed"].includes(rawStatus)) {
    return "released";
  }
  if (detail.refunded || rawStatus === "refunded") return "refunded";
  if (["cancelled", "canceled"].includes(rawStatus)) return "cancelled";
  if (rawStatus === "disputed") return "disputed";
  if (detail.expired || rawStatus === "expired") return "expired";
  if (["", "open", "pending", "active", "funded"].includes(rawStatus)) return "open";
  return "unknown";
}

/**
 * Format an integer Soroban amount (7 decimal Stellar base units) for display.
 * Decimal strings are treated as already human-readable, which also keeps the
 * helper compatible with a backend that elects to pre-format amounts.
 */
export function formatEscrowAmount(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";

  const raw = String(amount).trim();
  if (!raw) return "—";

  const decimalMatch = raw.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!decimalMatch) return raw;

  const [, sign, integerPart, fractionalPart] = decimalMatch;
  if (fractionalPart !== undefined) {
    const fraction = fractionalPart.replace(/0+$/, "");
    const integer = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
  }

  try {
    const baseUnits = BigInt(raw);
    const magnitude = baseUnits < 0n ? -baseUnits : baseUnits;
    const wholeUnits = magnitude / 10_000_000n;
    const fractionalUnits = (magnitude % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
    const integer = wholeUnits.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${baseUnits < 0n ? "-" : ""}${integer}${fractionalUnits ? `.${fractionalUnits}` : ""}`;
  } catch {
    return raw;
  }
}
