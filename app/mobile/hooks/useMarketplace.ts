import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMarketplaceListings,
  type FetchListingsOptions,
  type MarketplaceListing,
} from "../services/marketplace";

const PAGE_SIZE = 20;

export type MarketplaceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | {
      status: "success";
      listings: MarketplaceListing[];
      hasMore: boolean;
      loadingMore: boolean;
    };

export function useMarketplace(options: Omit<FetchListingsOptions, "cursor" | "limit"> = {}) {
  const [state, setState] = useState<MarketplaceState>({ status: "idle" });
  const nextCursorRef = useRef<string | null>(null);
  const isLoadingMoreRef = useRef(false);

  // Stable reference for options — only re-fetch when sort/filter values change
  const optionsKey = JSON.stringify(options);

  const loadFirstPage = useCallback(async () => {
    setState({ status: "loading" });
    nextCursorRef.current = null;

    try {
      const page = await fetchMarketplaceListings({ limit: PAGE_SIZE, ...options });
      nextCursorRef.current = page.next_cursor;
      setState({
        status: "success",
        listings: page.listings,
        hasMore: page.has_more,
        loadingMore: false,
      });
    } catch (err) {
      setState({
        status: "error",
        error: err instanceof Error ? err.message : "Failed to load listings.",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (isLoadingMoreRef.current) return;
    if (state.status !== "success" || !state.hasMore || !nextCursorRef.current) return;

    isLoadingMoreRef.current = true;
    setState((prev: MarketplaceState) =>
      prev.status === "success" ? { ...prev, loadingMore: true } : prev,
    );

    try {
      const page = await fetchMarketplaceListings({
        limit: PAGE_SIZE,
        cursor: nextCursorRef.current ?? undefined,
        ...options,
      });
      nextCursorRef.current = page.next_cursor;
      setState((prev: MarketplaceState) =>
        prev.status === "success"
          ? {
              ...prev,
              listings: [...prev.listings, ...page.listings],
              hasMore: page.has_more,
              loadingMore: false,
            }
          : prev,
      );
    } catch (err) {
      setState((prev: MarketplaceState) =>
        prev.status === "success" ? { ...prev, loadingMore: false } : prev,
      );
    } finally {
      isLoadingMoreRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, optionsKey]);

  return { state, refresh: loadFirstPage, loadMore };
}
