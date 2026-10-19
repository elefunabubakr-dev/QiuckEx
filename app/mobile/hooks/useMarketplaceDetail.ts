import { useCallback, useEffect, useState } from "react";
import {
  fetchMarketplaceListingDetail,
  type MarketplaceListingDetail,
} from "../services/marketplace";

export type MarketplaceDetailState =
  | { status: "loading" }
  | { status: "error"; error: string; notFound: boolean }
  | { status: "success"; detail: MarketplaceListingDetail };

export function useMarketplaceDetail(listingId: string, viewerPublicKey?: string) {
  const [state, setState] = useState<MarketplaceDetailState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const detail = await fetchMarketplaceListingDetail(listingId, viewerPublicKey);
      setState({ status: "success", detail });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load listing.";
      const notFound = message.includes("404") || message.toLowerCase().includes("not found");
      setState({ status: "error", error: message, notFound });
    }
  }, [listingId, viewerPublicKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, refresh: load };
}
