import { API_URL } from "../src/config/build";

/** API client for marketplace listing and bid endpoints. */
const API_BASE_URL = API_URL;

function getApiBaseUrl() {
  return API_BASE_URL.replace(/\/$/, "");
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new Error("Network request failed. Check your connection and try again.");
  }

  if (!response.ok) {
    let message = `Server error (${response.status})`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // keep status-code message
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

// ── Types ────────────────────────────────────────────────────────────────────

export type MarketplaceListingStatus = "active" | "sold" | "cancelled";

export interface MarketplaceListing {
  id: string;
  username: string;
  seller_public_key: string;
  asking_price: number;
  status: MarketplaceListingStatus;
  created_at: string;
  updated_at: string;
  sold_at: string | null;
  buyer_public_key: string | null;
  final_price: number | null;
  /** Attached by the query layer — may be absent on older API versions */
  bid_count?: number;
  high_bid?: number | null;
}

export interface MarketplaceListingsPage {
  listings: MarketplaceListing[];
  total: number;
  next_cursor: string | null;
  has_more: boolean;
}

export interface MarketplaceBid {
  id: string;
  listing_id: string;
  bidder_public_key: string;
  bid_amount: number;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  created_at: string;
  updated_at: string;
}

export interface MarketplaceStateHints {
  can_place_bid: boolean;
  can_watchlist: boolean;
  can_buy_now: boolean;
  is_available: boolean;
  unavailable_reason: string | null;
  minimum_bid_amount: number;
}

export interface MarketplaceSellerInfo {
  public_key: string;
  display_key: string;
}

export interface MarketplaceListingDetail {
  listing: MarketplaceListing;
  bids: MarketplaceBid[];
  seller: MarketplaceSellerInfo;
  state_hints: MarketplaceStateHints;
}

export interface FetchListingsOptions {
  limit?: number;
  cursor?: string;
  sort?: "newest" | "ending_soon" | "price_asc" | "price_desc";
  min_price?: number;
  max_price?: number;
  username?: string;
}

// ── API calls ────────────────────────────────────────────────────────────────

export async function fetchMarketplaceListings(
  options: FetchListingsOptions = {},
): Promise<MarketplaceListingsPage> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.sort) params.set("sort", options.sort);
  if (options.min_price !== undefined) params.set("min_price", String(options.min_price));
  if (options.max_price !== undefined) params.set("max_price", String(options.max_price));
  if (options.username) params.set("username", options.username);

  const qs = params.toString();
  return requestJson<MarketplaceListingsPage>(`/marketplace${qs ? `?${qs}` : ""}`);
}

export async function fetchMarketplaceListingDetail(
  listingId: string,
  viewerPublicKey?: string,
): Promise<MarketplaceListingDetail> {
  const params = new URLSearchParams();
  if (viewerPublicKey?.trim()) params.set("viewerPublicKey", viewerPublicKey.trim());

  const qs = params.toString();
  return requestJson<MarketplaceListingDetail>(
    `/marketplace/${encodeURIComponent(listingId)}/detail${qs ? `?${qs}` : ""}`,
  );
}

export async function placeBid(
  listingId: string,
  bidAmount: number,
  bidderPublicKey: string,
): Promise<MarketplaceBid> {
  const response = await requestJson<{ bid: MarketplaceBid }>(
    `/marketplace/${encodeURIComponent(listingId)}/bid`,
    {
      method: "POST",
      body: JSON.stringify({ bidderPublicKey, bidAmount }),
    },
  );
  return response.bid;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function formatPublicKey(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
