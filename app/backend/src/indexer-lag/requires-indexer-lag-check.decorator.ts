import { SetMetadata } from "@nestjs/common";

export const REQUIRE_INDEXER_LAG_CHECK_KEY = "REQUIRE_INDEXER_LAG_CHECK";

/**
 * How a route behaves while the indexer is behind the network.
 *
 * See `docs/INDEXER-LAG-GUARD-ROUTES.md` for the per-route rationale.
 */
export enum IndexerLagPolicy {
  /**
   * Fail closed: respond 503 with `Retry-After` while the indexer is behind.
   *
   * Use for reads that would return silently wrong results (stale rows joined
   * against a newer chain state) and for writes that re-derive decisions from
   * indexed state.
   */
  FAIL_CLOSED = "fail_closed",

  /**
   * Serve the response but advertise its staleness.
   *
   * Use for reads where a stale answer is still useful (activity feeds, recent
   * receipts) and where a hard 503 would be worse for the caller than a
   * clearly-labelled approximate answer.
   */
  STALE_HEADER = "stale_header",
}

/**
 * Mark a route (or controller) as reading indexed data, and declare how it
 * must behave when the indexer falls behind the network.
 *
 * Defaults to {@link IndexerLagPolicy.FAIL_CLOSED}. Routes without this
 * decorator are never blocked and never annotated.
 */
export const RequiresIndexerLagCheck = (
  policy: IndexerLagPolicy = IndexerLagPolicy.FAIL_CLOSED,
) => SetMetadata(REQUIRE_INDEXER_LAG_CHECK_KEY, policy);
