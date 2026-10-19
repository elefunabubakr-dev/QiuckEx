import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceErrorCode } from './errors';
import {
  SupabaseService,
  MarketplaceListing,
  MarketplaceBid,
  VerifiedMarketplacePayment,
} from '../supabase/supabase.service';
import {
  HorizonService,
  HorizonTransactionRecord,
  HorizonPaymentOperationRecord,
} from '../transactions/horizon.service';
import { UsernamesService } from '../usernames/usernames.service';

interface InMemoryMarketplaceDb {
  usernames: Map<string, { username: string; public_key: string }>;
  listings: Map<string, MarketplaceListing>;
  bids: Map<string, MarketplaceBid>;
  executeAcceptUsernameBidRpc: (params: {
    p_listing_id: string;
    p_bid_id: string;
    p_seller_public_key: string;
    p_payment_tx_hash?: string | null;
    p_verified_amount?: number | null;
    p_verified_payer?: string | null;
    p_verified_recipient?: string | null;
  }) => void;
}

function createInMemoryMarketplaceDb(): InMemoryMarketplaceDb {
  const usernames = new Map<string, { username: string; public_key: string }>();
  const listings = new Map<string, MarketplaceListing>();
  const bids = new Map<string, MarketplaceBid>();

  const executeAcceptUsernameBidRpc = (params: {
    p_listing_id: string;
    p_bid_id: string;
    p_seller_public_key: string;
    p_payment_tx_hash?: string | null;
    p_verified_amount?: number | null;
    p_verified_payer?: string | null;
    p_verified_recipient?: string | null;
  }) => {
    const normalizedTxHash = (params.p_payment_tx_hash ?? '').trim().toLowerCase();
    if (!normalizedTxHash || !/^[0-9a-f]{64}$/.test(normalizedTxHash)) {
      throw new Error(
        'PAYMENT_REQUIRED: A valid 64-character Stellar transaction hash is required to accept a bid',
      );
    }

    if (
      params.p_verified_amount === undefined ||
      params.p_verified_amount === null ||
      !params.p_verified_payer ||
      !params.p_verified_recipient
    ) {
      throw new Error(
        'PAYMENT_NOT_VERIFIED: On-chain payment verification proof is required before transferring username ownership',
      );
    }

    const listing = listings.get(params.p_listing_id);
    if (!listing) {
      throw new Error(
        `LISTING_NOT_FOUND: Listing ${params.p_listing_id} does not exist`,
      );
    }

    if (listing.status !== 'active') {
      throw new Error(
        `LISTING_NOT_ACTIVE: Listing is in status "${listing.status}"`,
      );
    }

    if (listing.seller_public_key !== params.p_seller_public_key) {
      throw new Error('UNAUTHORIZED: Caller is not the seller of this listing');
    }

    const bid = bids.get(params.p_bid_id);
    if (!bid || bid.listing_id !== params.p_listing_id) {
      throw new Error(
        `BID_NOT_FOUND: Bid ${params.p_bid_id} does not exist on this listing`,
      );
    }

    if (bid.status !== 'pending') {
      throw new Error(`BID_NOT_PENDING: Bid is in status "${bid.status}"`);
    }

    if (params.p_verified_payer !== bid.bidder_public_key) {
      throw new Error(
        `PAYMENT_MISMATCH: Verified payment sender (${params.p_verified_payer}) does not match bidder (${bid.bidder_public_key})`,
      );
    }

    if (params.p_verified_recipient !== listing.seller_public_key) {
      throw new Error(
        `PAYMENT_MISMATCH: Verified payment recipient (${params.p_verified_recipient}) does not match seller (${listing.seller_public_key})`,
      );
    }

    if (Number(params.p_verified_amount) < Number(bid.bid_amount)) {
      throw new Error(
        `PAYMENT_MISMATCH: Verified payment amount (${params.p_verified_amount}) is less than bid amount (${bid.bid_amount})`,
      );
    }

    for (const existingBid of bids.values()) {
      if (
        existingBid.id !== bid.id &&
        existingBid.status === 'accepted' &&
        existingBid.payment_tx_hash === normalizedTxHash
      ) {
        throw new Error(
          `PAYMENT_ALREADY_USED: Payment transaction ${normalizedTxHash} has already been used for another marketplace sale`,
        );
      }
    }

    for (const existingListing of listings.values()) {
      if (
        existingListing.id !== listing.id &&
        existingListing.status === 'sold' &&
        existingListing.payment_tx_hash === normalizedTxHash
      ) {
        throw new Error(
          `PAYMENT_ALREADY_USED: Payment transaction ${normalizedTxHash} has already been used for another marketplace sale`,
        );
      }
    }

    const now = new Date().toISOString();

    bid.status = 'accepted';
    bid.payment_tx_hash = normalizedTxHash;
    bid.payment_verified_at = now;
    bid.updated_at = now;

    for (const otherBid of bids.values()) {
      if (
        otherBid.listing_id === listing.id &&
        otherBid.id !== bid.id &&
        otherBid.status === 'pending'
      ) {
        otherBid.status = 'rejected';
        otherBid.updated_at = now;
      }
    }

    listing.status = 'sold';
    listing.sold_at = now;
    listing.buyer_public_key = bid.bidder_public_key;
    listing.final_price = bid.bid_amount;
    listing.payment_tx_hash = normalizedTxHash;
    listing.updated_at = now;

    const usernameRecord = usernames.get(listing.username);
    if (usernameRecord) {
      usernameRecord.public_key = bid.bidder_public_key;
    }
  };

  return { usernames, listings, bids, executeAcceptUsernameBidRpc };
}

describe('Marketplace Bid Acceptance On-Chain Payment Verification (Integration)', () => {
  const SELLER_PK = 'GBXGQ55JMQ4L2B6E7S8Y9Z0A1B2C3D4E5F6G7H8I7YWRSELLER00001';
  const BIDDER_PK = 'GBXGQ55JMQ4L2B6E7S8Y9Z0A1B2C3D4E5F6G7H8I7YWRBIDDER00001';
  const COMPETING_BIDDER_PK =
    'GBXGQ55JMQ4L2B6E7S8Y9Z0A1B2C3D4E5F6G7H8I7YWRBIDDER00002';
  const OTHER_WALLET_PK =
    'GBXGQ55JMQ4L2B6E7S8Y9Z0A1B2C3D4E5F6G7H8I7YWROTHER000003';

  const VALID_TX_HASH =
    'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0';
  const SECOND_TX_HASH =
    'b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef012';

  let controller: MarketplaceController;
  let db: InMemoryMarketplaceDb;
  let horizonTransactions: Map<string, HorizonTransactionRecord>;
  let horizonOperations: Map<string, HorizonPaymentOperationRecord[]>;

  beforeEach(async () => {
    db = createInMemoryMarketplaceDb();
    horizonTransactions = new Map();
    horizonOperations = new Map();

    db.usernames.set('stellar_king', {
      username: 'stellar_king',
      public_key: SELLER_PK,
    });
    db.usernames.set('soroban_pro', {
      username: 'soroban_pro',
      public_key: SELLER_PK,
    });

    db.listings.set('listing-1', {
      id: 'listing-1',
      username: 'stellar_king',
      seller_public_key: SELLER_PK,
      asking_price: 100,
      status: 'active',
      created_at: '2026-10-18T10:00:00.000Z',
      updated_at: '2026-10-18T10:00:00.000Z',
      sold_at: null,
      buyer_public_key: null,
      final_price: null,
      payment_tx_hash: null,
    });

    db.listings.set('listing-2', {
      id: 'listing-2',
      username: 'soroban_pro',
      seller_public_key: SELLER_PK,
      asking_price: 80,
      status: 'active',
      created_at: '2026-10-18T10:05:00.000Z',
      updated_at: '2026-10-18T10:05:00.000Z',
      sold_at: null,
      buyer_public_key: null,
      final_price: null,
      payment_tx_hash: null,
    });

    db.bids.set('bid-1', {
      id: 'bid-1',
      listing_id: 'listing-1',
      bidder_public_key: BIDDER_PK,
      bid_amount: 125.5,
      status: 'pending',
      payment_tx_hash: null,
      payment_verified_at: null,
      created_at: '2026-10-18T11:00:00.000Z',
      updated_at: '2026-10-18T11:00:00.000Z',
    });

    db.bids.set('bid-competing', {
      id: 'bid-competing',
      listing_id: 'listing-1',
      bidder_public_key: COMPETING_BIDDER_PK,
      bid_amount: 110,
      status: 'pending',
      payment_tx_hash: null,
      payment_verified_at: null,
      created_at: '2026-10-18T11:05:00.000Z',
      updated_at: '2026-10-18T11:05:00.000Z',
    });

    db.bids.set('bid-2', {
      id: 'bid-2',
      listing_id: 'listing-2',
      bidder_public_key: BIDDER_PK,
      bid_amount: 125.5,
      status: 'pending',
      payment_tx_hash: null,
      payment_verified_at: null,
      created_at: '2026-10-18T11:10:00.000Z',
      updated_at: '2026-10-18T11:10:00.000Z',
    });

    const supabaseStub: Partial<SupabaseService> = {
      getListingById: jest.fn(async (id: string) => db.listings.get(id) ?? null),
      getBidById: jest.fn(async (id: string) => db.bids.get(id) ?? null),
      isMarketplacePaymentTxUsed: jest.fn(
        async (txHash: string, excludeBidId?: string) => {
          const normalized = txHash.trim().toLowerCase();
          for (const bid of db.bids.values()) {
            if (
              bid.id !== excludeBidId &&
              bid.status === 'accepted' &&
              bid.payment_tx_hash === normalized
            ) {
              return true;
            }
          }
          for (const listing of db.listings.values()) {
            if (
              listing.status === 'sold' &&
              listing.payment_tx_hash === normalized
            ) {
              return true;
            }
          }
          return false;
        },
      ),
      acceptBid: jest.fn(
        async (
          listingId: string,
          bidId: string,
          sellerPublicKey: string,
          payment: VerifiedMarketplacePayment,
        ) => {
          db.executeAcceptUsernameBidRpc({
            p_listing_id: listingId,
            p_bid_id: bidId,
            p_seller_public_key: sellerPublicKey,
            p_payment_tx_hash: payment?.paymentTxHash,
            p_verified_amount: payment?.verifiedAmount,
            p_verified_payer: payment?.verifiedPayer,
            p_verified_recipient: payment?.verifiedRecipient,
          });
        },
      ),
    };

    const horizonStub: Partial<HorizonService> = {
      getTransactionByHash: jest.fn(
        async (txHash: string) =>
          horizonTransactions.get(txHash.toLowerCase()) ?? null,
      ),
      getTransactionOperations: jest.fn(
        async (txHash: string) =>
          horizonOperations.get(txHash.toLowerCase()) ?? [],
      ),
    };

    const usernamesStub: Partial<UsernamesService> = {
      listByPublicKey: jest.fn(async (pk: string) =>
        Array.from(db.usernames.values())
          .filter((u) => u.public_key === pk)
          .map((u) => ({
            id: u.username,
            username: u.username,
            public_key: u.public_key,
            created_at: '2026-10-18T00:00:00.000Z',
            is_public: true,
          })),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MarketplaceController],
      providers: [
        MarketplaceService,
        { provide: SupabaseService, useValue: supabaseStub },
        { provide: HorizonService, useValue: horizonStub },
        { provide: UsernamesService, useValue: usernamesStub },
      ],
    }).compile();

    controller = module.get<MarketplaceController>(MarketplaceController);
  });

  function assertNoOwnershipTransferOccurred(listingId = 'listing-1', bidId = 'bid-1') {
    const listing = db.listings.get(listingId)!;
    const bid = db.bids.get(bidId)!;
    const usernameOwner = db.usernames.get(listing.username)!;

    expect(bid.status).toBe('pending');
    expect(bid.payment_tx_hash).toBeNull();
    expect(listing.status).toBe('active');
    expect(listing.buyer_public_key).toBeNull();
    expect(listing.sold_at).toBeNull();
    expect(usernameOwner.public_key).toBe(SELLER_PK);
  }

  it('rejects accepting a bid without payment proof and leaves bid pending and ownership with seller', async () => {
    const missingPaymentErr = await controller
      .acceptBid('listing-1', 'bid-1', {
        sellerPublicKey: SELLER_PK,
        paymentTxHash: '',
      })
      .catch((e) => e);

    expect(missingPaymentErr).toBeInstanceOf(BadRequestException);
    expect(missingPaymentErr.getResponse()).toMatchObject({
      code: MarketplaceErrorCode.PAYMENT_REQUIRED,
    });
    assertNoOwnershipTransferOccurred();

    const malformedHashErr = await controller
      .acceptBid('listing-1', 'bid-1', {
        sellerPublicKey: SELLER_PK,
        paymentTxHash: '12345-not-hex',
      })
      .catch((e) => e);

    expect(malformedHashErr).toBeInstanceOf(BadRequestException);
    expect(malformedHashErr.getResponse()).toMatchObject({
      code: MarketplaceErrorCode.PAYMENT_REQUIRED,
    });
    assertNoOwnershipTransferOccurred();
  });

  it('rejects accepting a bid when payment transaction is missing or failed on-chain and leaves bid pending', async () => {
    // 1. Transaction does not exist on Horizon (404 -> null)
    const notFoundErr = await controller
      .acceptBid('listing-1', 'bid-1', {
        sellerPublicKey: SELLER_PK,
        paymentTxHash: VALID_TX_HASH,
      })
      .catch((e) => e);

    expect(notFoundErr).toBeInstanceOf(BadRequestException);
    expect(notFoundErr.getResponse()).toMatchObject({
      code: MarketplaceErrorCode.PAYMENT_NOT_VERIFIED,
    });
    assertNoOwnershipTransferOccurred();

    // 2. Transaction exists on Horizon but failed (successful = false)
    horizonTransactions.set(VALID_TX_HASH, {
      id: VALID_TX_HASH,
      hash: VALID_TX_HASH,
      successful: false,
      source_account: BIDDER_PK,
    });
    horizonOperations.set(VALID_TX_HASH, [
      {
        type: 'payment',
        transaction_successful: false,
        from: BIDDER_PK,
        to: SELLER_PK,
        amount: '125.5000000',
        asset_type: 'native',
      },
    ]);

    const failedTxErr = await controller
      .acceptBid('listing-1', 'bid-1', {
        sellerPublicKey: SELLER_PK,
        paymentTxHash: VALID_TX_HASH,
      })
      .catch((e) => e);

    expect(failedTxErr).toBeInstanceOf(BadRequestException);
    expect(failedTxErr.getResponse()).toMatchObject({
      code: MarketplaceErrorCode.PAYMENT_NOT_VERIFIED,
    });
    assertNoOwnershipTransferOccurred();
  });

  it('rejects accepting a bid when on-chain payment sender, recipient, asset, or amount does not match', async () => {
    horizonTransactions.set(VALID_TX_HASH, {
      id: VALID_TX_HASH,
      hash: VALID_TX_HASH,
      successful: true,
      source_account: BIDDER_PK,
    });

    // Case A: Underpaid amount (100 XLM < 125.5 XLM bid_amount)
    horizonOperations.set(VALID_TX_HASH, [
      {
        type: 'payment',
        transaction_successful: true,
        from: BIDDER_PK,
        to: SELLER_PK,
        amount: '100.0000000',
        asset_type: 'native',
      },
    ]);

    const underpaidErr = await controller
      .acceptBid('listing-1', 'bid-1', {
        sellerPublicKey: SELLER_PK,
        paymentTxHash: VALID_TX_HASH,
      })
      .catch((e) => e);

    expect(underpaidErr).toBeInstanceOf(BadRequestException);
    expect(underpaidErr.getResponse()).toMatchObject({
      code: MarketplaceErrorCode.PAYMENT_MISMATCH,
    });
    assertNoOwnershipTransferOccurred();

    // Case B: Wrong sender (paid by OTHER_WALLET_PK instead of BIDDER_PK)
    horizonOperations.set(VALID_TX_HASH, [
      {
        type: 'payment',
        transaction_successful: true,
        from: OTHER_WALLET_PK,
        to: SELLER_PK,
        amount: '125.5000000',
        asset_type: 'native',
      },
    ]);

    const wrongSenderErr = await controller
      .acceptBid('listing-1', 'bid-1', {
        sellerPublicKey: SELLER_PK,
        paymentTxHash: VALID_TX_HASH,
      })
      .catch((e) => e);

    expect(wrongSenderErr).toBeInstanceOf(BadRequestException);
    expect(wrongSenderErr.getResponse()).toMatchObject({
      code: MarketplaceErrorCode.PAYMENT_MISMATCH,
    });
    assertNoOwnershipTransferOccurred();

    // Case C: Wrong recipient (paid to OTHER_WALLET_PK instead of SELLER_PK)
    horizonOperations.set(VALID_TX_HASH, [
      {
        type: 'payment',
        transaction_successful: true,
        from: BIDDER_PK,
        to: OTHER_WALLET_PK,
        amount: '125.5000000',
        asset_type: 'native',
      },
    ]);

    const wrongRecipientErr = await controller
      .acceptBid('listing-1', 'bid-1', {
        sellerPublicKey: SELLER_PK,
        paymentTxHash: VALID_TX_HASH,
      })
      .catch((e) => e);

    expect(wrongRecipientErr).toBeInstanceOf(BadRequestException);
    expect(wrongRecipientErr.getResponse()).toMatchObject({
      code: MarketplaceErrorCode.PAYMENT_MISMATCH,
    });
    assertNoOwnershipTransferOccurred();

    // Case D: Non-native asset
    horizonOperations.set(VALID_TX_HASH, [
      {
        type: 'payment',
        transaction_successful: true,
        from: BIDDER_PK,
        to: SELLER_PK,
        amount: '125.5000000',
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        asset_issuer: OTHER_WALLET_PK,
      },
    ]);

    const wrongAssetErr = await controller
      .acceptBid('listing-1', 'bid-1', {
        sellerPublicKey: SELLER_PK,
        paymentTxHash: VALID_TX_HASH,
      })
      .catch((e) => e);

    expect(wrongAssetErr).toBeInstanceOf(BadRequestException);
    expect(wrongAssetErr.getResponse()).toMatchObject({
      code: MarketplaceErrorCode.PAYMENT_MISMATCH,
    });
    assertNoOwnershipTransferOccurred();
  });

  it('rejects direct accept_username_bid RPC calls when payment verification parameters are missing or mismatched', () => {
    expect(() =>
      db.executeAcceptUsernameBidRpc({
        p_listing_id: 'listing-1',
        p_bid_id: 'bid-1',
        p_seller_public_key: SELLER_PK,
      }),
    ).toThrow(/PAYMENT_REQUIRED/);
    assertNoOwnershipTransferOccurred();

    expect(() =>
      db.executeAcceptUsernameBidRpc({
        p_listing_id: 'listing-1',
        p_bid_id: 'bid-1',
        p_seller_public_key: SELLER_PK,
        p_payment_tx_hash: VALID_TX_HASH,
      }),
    ).toThrow(/PAYMENT_NOT_VERIFIED/);
    assertNoOwnershipTransferOccurred();

    expect(() =>
      db.executeAcceptUsernameBidRpc({
        p_listing_id: 'listing-1',
        p_bid_id: 'bid-1',
        p_seller_public_key: SELLER_PK,
        p_payment_tx_hash: VALID_TX_HASH,
        p_verified_amount: 50,
        p_verified_payer: BIDDER_PK,
        p_verified_recipient: SELLER_PK,
      }),
    ).toThrow(/PAYMENT_MISMATCH/);
    assertNoOwnershipTransferOccurred();
  });

  it('accepts bid and transfers username ownership when on-chain payment from bidder to seller is verified, and blocks replay', async () => {
    horizonTransactions.set(VALID_TX_HASH, {
      id: VALID_TX_HASH,
      hash: VALID_TX_HASH,
      successful: true,
      source_account: BIDDER_PK,
    });
    horizonOperations.set(VALID_TX_HASH, [
      {
        type: 'payment',
        transaction_successful: true,
        from: BIDDER_PK,
        to: SELLER_PK,
        amount: '125.5000000',
        asset_type: 'native',
      },
    ]);

    const response = await controller.acceptBid('listing-1', 'bid-1', {
      sellerPublicKey: SELLER_PK,
      paymentTxHash: VALID_TX_HASH,
    });

    expect(response).toEqual({ ok: true });

    const acceptedBid = db.bids.get('bid-1')!;
    const competingBid = db.bids.get('bid-competing')!;
    const soldListing = db.listings.get('listing-1')!;
    const transferredUsername = db.usernames.get('stellar_king')!;

    expect(acceptedBid.status).toBe('accepted');
    expect(acceptedBid.payment_tx_hash).toBe(VALID_TX_HASH);
    expect(acceptedBid.payment_verified_at).toEqual(expect.any(String));
    expect(competingBid.status).toBe('rejected');

    expect(soldListing.status).toBe('sold');
    expect(soldListing.buyer_public_key).toBe(BIDDER_PK);
    expect(soldListing.final_price).toBe(125.5);
    expect(soldListing.payment_tx_hash).toBe(VALID_TX_HASH);
    expect(soldListing.sold_at).toEqual(expect.any(String));

    expect(transferredUsername.public_key).toBe(BIDDER_PK);

    // Attempting to replay the same payment transaction hash on listing-2 / bid-2 must be rejected with 409 Conflict
    const replayErr = await controller
      .acceptBid('listing-2', 'bid-2', {
        sellerPublicKey: SELLER_PK,
        paymentTxHash: VALID_TX_HASH,
      })
      .catch((e) => e);

    expect(replayErr).toBeInstanceOf(ConflictException);
    expect(replayErr.getResponse()).toMatchObject({
      code: MarketplaceErrorCode.PAYMENT_ALREADY_USED,
    });
    assertNoOwnershipTransferOccurred('listing-2', 'bid-2');

    // A fresh verified payment transaction for listing-2 / bid-2 succeeds
    horizonTransactions.set(SECOND_TX_HASH, {
      id: SECOND_TX_HASH,
      hash: SECOND_TX_HASH,
      successful: true,
      source_account: BIDDER_PK,
    });
    horizonOperations.set(SECOND_TX_HASH, [
      {
        type: 'payment',
        transaction_successful: true,
        from: BIDDER_PK,
        to: SELLER_PK,
        amount: '125.5000000',
        asset_type: 'native',
      },
    ]);

    const secondResponse = await controller.acceptBid('listing-2', 'bid-2', {
      sellerPublicKey: SELLER_PK,
      paymentTxHash: SECOND_TX_HASH,
    });
    expect(secondResponse).toEqual({ ok: true });
    expect(db.usernames.get('soroban_pro')!.public_key).toBe(BIDDER_PK);
  });

  it('rejects non-seller callers with ForbiddenException before attempting payment verification', async () => {
    const err = await controller
      .acceptBid('listing-1', 'bid-1', {
        sellerPublicKey: OTHER_WALLET_PK,
        paymentTxHash: VALID_TX_HASH,
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({
      code: MarketplaceErrorCode.UNAUTHORIZED,
    });
    assertNoOwnershipTransferOccurred();
  });
});
