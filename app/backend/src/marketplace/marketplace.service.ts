import { Injectable, Optional } from '@nestjs/common';
import {
  SupabaseService,
  MarketplaceListing,
  MarketplaceBid,
  VerifiedMarketplacePayment,
} from '../supabase/supabase.service';
import { SupabaseUniqueConstraintError } from '../supabase/supabase.errors';
import {
  HorizonService,
  HorizonPaymentOperationRecord,
} from '../transactions/horizon.service';
import { UsernamesService } from '../usernames/usernames.service';
import { MarketplaceError, MarketplaceErrorCode } from './errors';
import {
  buildMarketplaceStateHints,
  buildBidSummary,
  resolveHighBidAmount,
  truncateStellarPublicKey,
} from './marketplace-listing-detail';
import { MarketplaceListingDetailDto } from './dto/marketplace-listing-detail.dto';
import { GetMarketplaceListingsDto } from './dto/get-marketplace-listings.dto';
import { GetMarketplaceListingsResponseDto } from './dto/marketplace-listing-summary.dto';
import {
  attachBidData,
  DEFAULT_MARKETPLACE_SORT,
  groupBidsByListingId,
  resolveSortColumn,
} from './marketplace-listing-query';

const STELLAR_TX_HASH_REGEX = /^[a-f0-9]{64}$/i;
const STROOPS_PER_XLM = 10_000_000n;
const PAYMENT_OPERATION_TYPES = new Set([
  'payment',
  'path_payment_strict_receive',
  'path_payment_strict_send',
]);

function toStroops(value: number | string): bigint | null {
  const raw = typeof value === 'number' ? value.toFixed(7) : String(value).trim();
  if (!/^\d+(\.\d{1,7})?$/.test(raw)) {
    return null;
  }
  const [wholePart, fracPart = ''] = raw.split('.');
  const paddedFrac = (fracPart + '0000000').slice(0, 7);
  return BigInt(wholePart) * STROOPS_PER_XLM + BigInt(paddedFrac);
}

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly usernames: UsernamesService,
    @Optional() private readonly horizon?: HorizonService,
  ) {}

  async listUsername(
    username: string,
    sellerPublicKey: string,
    askingPrice: number,
  ): Promise<MarketplaceListing> {
    const normalized = username.trim().toLowerCase();

    const owned = await this.usernames.listByPublicKey(sellerPublicKey);
    if (!owned.find((u) => u.username === normalized)) {
      throw new MarketplaceError(
        MarketplaceErrorCode.USERNAME_NOT_OWNED,
        'Username not found or does not belong to this wallet',
      );
    }

    const existing = await this.supabase.getActiveListingByUsername(normalized);
    if (existing) {
      throw new MarketplaceError(
        MarketplaceErrorCode.ALREADY_LISTED,
        'Username already has an active listing',
      );
    }

    try {
      return await this.supabase.createListing(normalized, sellerPublicKey, askingPrice);
    } catch (err) {
      if (err instanceof SupabaseUniqueConstraintError) {
        throw new MarketplaceError(
          MarketplaceErrorCode.ALREADY_LISTED,
          'Username already has an active listing',
        );
      }
      throw err;
    }
  }

  async queryListings(
    query: GetMarketplaceListingsDto,
  ): Promise<GetMarketplaceListingsResponseDto> {
    if (
      query.min_price !== undefined &&
      query.max_price !== undefined &&
      query.min_price > query.max_price
    ) {
      throw new MarketplaceError(
        MarketplaceErrorCode.INVALID_PRICE_RANGE,
        'min_price cannot be greater than max_price',
      );
    }

    const { column, ascending } = resolveSortColumn(query.sort ?? DEFAULT_MARKETPLACE_SORT);

    const page = await this.supabase.queryActiveListings({
      limit: query.limit ?? 20,
      cursor: query.cursor ?? null,
      sortColumn: column,
      ascending,
      minPrice: query.min_price,
      maxPrice: query.max_price,
      username: query.username,
    });

    const listingIds = page.listings.map((listing) => listing.id);
    const bids = await this.supabase.getBidsForListingIds(listingIds);
    const bidsByListingId = groupBidsByListingId(bids);

    return {
      listings: attachBidData(page.listings, bidsByListingId),
      total: page.total,
      next_cursor: page.next_cursor,
      has_more: page.has_more,
    };
  }

  async getListing(listingId: string): Promise<MarketplaceListing> {
    const listing = await this.supabase.getListingById(listingId);
    if (!listing) {
      throw new MarketplaceError(
        MarketplaceErrorCode.LISTING_NOT_FOUND,
        'Listing not found',
      );
    }
    return listing;
  }

  async getListingDetail(
    listingId: string,
    viewerPublicKey?: string | null,
  ): Promise<MarketplaceListingDetailDto> {
    const listing = await this.getListing(listingId);

    const bidPage = await this.supabase.getBidsByListingIdPaginated(
      listingId,
      50,
      null,
    );

    const highBidAmount = resolveHighBidAmount(
      Number(listing.asking_price),
      bidPage.bids,
    );

    return {
      listing,
      bids: bidPage.bids,
      bid_summary: buildBidSummary(bidPage.bids),
      seller: {
        public_key: listing.seller_public_key,
        display_key: truncateStellarPublicKey(listing.seller_public_key),
      },
      state_hints: buildMarketplaceStateHints(
        listing,
        highBidAmount,
        viewerPublicKey,
      ),
    };
  }

  async cancelListing(listingId: string, sellerPublicKey: string): Promise<void> {
    const listing = await this.getListing(listingId);

    if (listing.seller_public_key !== sellerPublicKey) {
      throw new MarketplaceError(
        MarketplaceErrorCode.UNAUTHORIZED,
        'Only the seller can cancel this listing',
      );
    }

    if (listing.status !== 'active') {
      throw new MarketplaceError(
        MarketplaceErrorCode.LISTING_NOT_ACTIVE,
        'Only active listings can be cancelled',
      );
    }

    await this.supabase.cancelListing(listingId);
  }

  async placeBid(
    listingId: string,
    bidderPublicKey: string,
    bidAmount: number,
  ): Promise<MarketplaceBid> {
    const listing = await this.getListing(listingId);

    if (listing.status !== 'active') {
      throw new MarketplaceError(
        MarketplaceErrorCode.LISTING_NOT_ACTIVE,
        'Listing is no longer active',
      );
    }

    if (listing.seller_public_key === bidderPublicKey) {
      throw new MarketplaceError(
        MarketplaceErrorCode.SELF_BID,
        'Seller cannot bid on their own listing',
      );
    }

    return this.supabase.placeBid(listingId, bidderPublicKey, bidAmount);
  }

  async getBids(listingId: string, limit: number = 20, cursor: string | null = null): Promise<{ bids: MarketplaceBid[]; next_cursor: string | null; has_more: boolean }> {
    await this.getListing(listingId);
    return this.supabase.getBidsByListingIdPaginated(listingId, limit, cursor);
  }

  async acceptBid(
    listingId: string,
    bidId: string,
    sellerPublicKey: string,
    paymentTxHash?: string,
  ): Promise<void> {
    const listing = await this.getListing(listingId);

    if (listing.seller_public_key !== sellerPublicKey) {
      throw new MarketplaceError(
        MarketplaceErrorCode.UNAUTHORIZED,
        'Only the seller can accept a bid',
      );
    }

    if (listing.status !== 'active') {
      throw new MarketplaceError(
        MarketplaceErrorCode.LISTING_NOT_ACTIVE,
        'Listing is no longer active',
      );
    }

    const bid = await this.supabase.getBidById(bidId);
    if (!bid || bid.listing_id !== listingId) {
      throw new MarketplaceError(
        MarketplaceErrorCode.BID_NOT_FOUND,
        'Bid not found on this listing',
      );
    }

    if (bid.status !== 'pending') {
      throw new MarketplaceError(
        MarketplaceErrorCode.BID_NOT_PENDING,
        'Bid is no longer pending',
      );
    }

    const normalizedTxHash = paymentTxHash?.trim().toLowerCase() ?? '';
    if (!normalizedTxHash || !STELLAR_TX_HASH_REGEX.test(normalizedTxHash)) {
      throw new MarketplaceError(
        MarketplaceErrorCode.PAYMENT_REQUIRED,
        'A valid 64-character Stellar payment transaction hash is required to accept a bid',
      );
    }

    if (typeof this.supabase.isMarketplacePaymentTxUsed === 'function') {
      const alreadyUsed = await this.supabase.isMarketplacePaymentTxUsed(
        normalizedTxHash,
        bidId,
      );
      if (alreadyUsed) {
        throw new MarketplaceError(
          MarketplaceErrorCode.PAYMENT_ALREADY_USED,
          'Payment transaction has already been used for another marketplace sale',
        );
      }
    }

    const verifiedPayment = await this.verifyBidPaymentOnChain(
      normalizedTxHash,
      bid,
      listing,
    );

    try {
      await this.supabase.acceptBid(
        listingId,
        bidId,
        sellerPublicKey,
        verifiedPayment,
      );
    } catch (err) {
      if (err instanceof MarketplaceError) {
        throw err;
      }
      if (err instanceof SupabaseUniqueConstraintError) {
        throw new MarketplaceError(
          MarketplaceErrorCode.PAYMENT_ALREADY_USED,
          'Payment transaction has already been used for another marketplace sale',
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('PAYMENT_ALREADY_USED')) {
        throw new MarketplaceError(
          MarketplaceErrorCode.PAYMENT_ALREADY_USED,
          'Payment transaction has already been used for another marketplace sale',
        );
      }
      if (message.includes('PAYMENT_REQUIRED')) {
        throw new MarketplaceError(
          MarketplaceErrorCode.PAYMENT_REQUIRED,
          message,
        );
      }
      if (message.includes('PAYMENT_NOT_VERIFIED')) {
        throw new MarketplaceError(
          MarketplaceErrorCode.PAYMENT_NOT_VERIFIED,
          message,
        );
      }
      if (message.includes('PAYMENT_MISMATCH')) {
        throw new MarketplaceError(
          MarketplaceErrorCode.PAYMENT_MISMATCH,
          message,
        );
      }
      throw err;
    }
  }

  private async verifyBidPaymentOnChain(
    txHash: string,
    bid: MarketplaceBid,
    listing: MarketplaceListing,
  ): Promise<VerifiedMarketplacePayment> {
    if (!this.horizon) {
      throw new MarketplaceError(
        MarketplaceErrorCode.PAYMENT_NOT_VERIFIED,
        'On-chain payment verification service is unavailable',
      );
    }

    let tx;
    let operations: HorizonPaymentOperationRecord[];
    try {
      tx = await this.horizon.getTransactionByHash(txHash);
      if (!tx) {
        throw new MarketplaceError(
          MarketplaceErrorCode.PAYMENT_NOT_VERIFIED,
          `Payment transaction ${txHash} was not found on-chain`,
        );
      }

      if (tx.successful !== true) {
        throw new MarketplaceError(
          MarketplaceErrorCode.PAYMENT_NOT_VERIFIED,
          `Payment transaction ${txHash} was not successful on-chain`,
        );
      }

      if (tx.hash && tx.hash.toLowerCase() !== txHash) {
        throw new MarketplaceError(
          MarketplaceErrorCode.PAYMENT_NOT_VERIFIED,
          'On-chain transaction hash does not match provided paymentTxHash',
        );
      }

      operations = await this.horizon.getTransactionOperations(txHash);
    } catch (err) {
      if (err instanceof MarketplaceError) {
        throw err;
      }
      throw new MarketplaceError(
        MarketplaceErrorCode.PAYMENT_NOT_VERIFIED,
        `Failed to verify payment transaction ${txHash} on Horizon`,
      );
    }

    if (!operations || operations.length === 0) {
      throw new MarketplaceError(
        MarketplaceErrorCode.PAYMENT_NOT_VERIFIED,
        `No operations found for payment transaction ${txHash}`,
      );
    }

    const paymentOps = operations.filter(
      (op) =>
        PAYMENT_OPERATION_TYPES.has(op.type) &&
        op.transaction_successful !== false,
    );

    if (paymentOps.length === 0) {
      throw new MarketplaceError(
        MarketplaceErrorCode.PAYMENT_MISMATCH,
        'Transaction does not contain a valid payment operation',
      );
    }

    const requiredStroops = toStroops(Number(bid.bid_amount));
    if (requiredStroops === null || requiredStroops <= 0n) {
      throw new MarketplaceError(
        MarketplaceErrorCode.INVALID_PRICE,
        'Invalid bid amount on bid record',
      );
    }

    let mismatchReason =
      'On-chain payment does not match bidder, seller, asset, or bid amount';

    for (const op of paymentOps) {
      const sender = op.from ?? op.source_account ?? tx.source_account;
      const recipient = op.to;

      if (sender !== bid.bidder_public_key) {
        mismatchReason = `Payment sender (${sender ?? 'unknown'}) does not match bidder (${bid.bidder_public_key})`;
        continue;
      }

      if (recipient !== listing.seller_public_key) {
        mismatchReason = `Payment recipient (${recipient ?? 'unknown'}) does not match seller (${listing.seller_public_key})`;
        continue;
      }

      if (op.asset_type !== 'native') {
        mismatchReason = 'Marketplace bid payments must use native XLM asset';
        continue;
      }

      const paidStroops = op.amount !== undefined ? toStroops(op.amount) : null;
      if (paidStroops === null || paidStroops < requiredStroops) {
        mismatchReason = `Payment amount (${op.amount ?? '0'}) is less than bid amount (${bid.bid_amount})`;
        continue;
      }

      return {
        paymentTxHash: txHash,
        verifiedAmount: Number(op.amount),
        verifiedPayer: sender,
        verifiedRecipient: recipient,
      };
    }

    throw new MarketplaceError(
      MarketplaceErrorCode.PAYMENT_MISMATCH,
      mismatchReason,
    );
  }
}
