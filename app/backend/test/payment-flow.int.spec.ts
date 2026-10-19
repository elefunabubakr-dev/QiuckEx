/**
 * Integration test: Payment flow end-to-end
 *
 * Tests the full payment lifecycle:
 *   1. Create a payment link (via PaymentLinkService)
 *   2. Check status → ACTIVE
 *   3. Simulate on-chain payment (mock Horizon)
 *   4. Check status → PAID
 *   5. Simulate link expiry
 *   6. Verify state machine transitions
 *
 * External services (Horizon, Supabase) are mocked. All fixtures (usernames,
 * public keys, payment links, transactions and receipts) come from the
 * deterministic seeding utility, and each test is isolated via
 * `createTestIsolation`.
 */
import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { PaymentLinkService } from "../src/links/payment-link.service";
import { HorizonService } from "../src/transactions/horizon.service";
import {
  PAYMENT_LINKS_REPOSITORY,
  type ExpiredPaymentLinkRow,
  type PaymentLinksRepository,
} from "../src/links/payment-links.repository";
import { LinksService } from "../src/links/links.service";
import { LinkState } from "../src/links/link-state-machine";
import { LinkMetadataResponseDto } from "../src/dto/link/link-metadata-response.dto";
import { TransactionItemDto } from "../src/transactions/dto/transaction.dto";
import { PaymentLinkExpiryService } from "../src/links/payment-link-expiry.service";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { AuditService } from "../src/audit/audit.service";
import { createInMemorySeedStore } from "../src/testing/in-memory-seed.store";
import { createTestIsolation } from "../src/testing/test-isolation.util";

describe("Payment Flow Integration", () => {
  let paymentLinkService: PaymentLinkService;
  let expiryService: PaymentLinkExpiryService;
  let horizonService: jest.Mocked<HorizonService>;
  let paymentLinksRepository: jest.Mocked<PaymentLinksRepository>;
  let linksService: jest.Mocked<LinksService>;
  let auditService: jest.Mocked<AuditService>;
  let events: EventEmitter2;
  let isolation: ReturnType<typeof createTestIsolation>;
  let store: ReturnType<typeof createInMemorySeedStore>;

  let DEST_PUBLIC_KEY: string;
  let baseMetadata: LinkMetadataResponseDto;
  let paidPaymentItem: TransactionItemDto;

  beforeEach(async () => {
    store = createInMemorySeedStore();
    isolation = createTestIsolation(store.client);
    await isolation.seed();

    const [seedUser] = store.rows("users");
    const [seedLink] = store.rows("links");
    const [seedTransaction] = store.rows("transactions");
    const aliceUsername = store.findOne("usernames", "username", "alice");

    DEST_PUBLIC_KEY = String(aliceUsername.public_key);

    baseMetadata = {
      amount: String(seedLink.amount),
      asset: String(seedLink.asset_code),
      username: String(seedLink.username),
      memo: String(seedLink.memo),
      memoType: "text",
      privacy: false,
      expiresAt: new Date(Date.now() + 30 * 86400000),
      acceptedAssets: [String(seedLink.asset_code)],
      swapOptions: null,
      canonical: String(seedLink.canonical),
      metadata: {
        normalized: false,
        assetType: "native",
        linkType: "standard",
        securityLevel: "medium",
      },
    };

    paidPaymentItem = {
      amount: String(seedLink.amount),
      asset: String(seedLink.asset_code),
      memo: String(seedLink.memo),
      timestamp: new Date().toISOString(),
      txHash: String(seedTransaction.transaction_hash),
      source: String(seedUser.public_key),
      destination: DEST_PUBLIC_KEY,
      status: "Success",
      pagingToken: String(seedTransaction.paging_token),
    };

    paymentLinksRepository = {
      getPublicKeyByUsername: jest.fn(),
      markExpiredLinks: jest.fn().mockResolvedValue([]),
      insertExpiryAudit: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PaymentLinksRepository>;

    paymentLinksRepository.getPublicKeyByUsername.mockImplementation(
      async (username: string) => {
        const row = store.findOne("usernames", "username", username);
        return row ? (row.public_key as string) : null;
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentLinkService,
        PaymentLinkExpiryService,
        {
          provide: HorizonService,
          useValue: { getPayments: jest.fn() },
        },
        {
          provide: PAYMENT_LINKS_REPOSITORY,
          useValue: paymentLinksRepository,
        },
        {
          provide: LinksService,
          useValue: { generateMetadata: jest.fn() },
        },
        {
          provide: EventEmitter2,
          useValue: new EventEmitter2(),
        },
        {
          provide: AuditService,
          useValue: { log: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    paymentLinkService = module.get(PaymentLinkService);
    expiryService = module.get(PaymentLinkExpiryService);
    horizonService = module.get(HorizonService);
    linksService = module.get(LinksService);
    auditService = module.get(AuditService);
    events = module.get(EventEmitter2);
  });

  afterEach(async () => {
    await isolation.cleanup();
  });

  // -------------------------------------------------------------------------
  // Scenario 1: Full payment lifecycle (create → pay)
  // -------------------------------------------------------------------------
  describe("Scenario 1: Payment link created then paid", () => {
    it("should transition from ACTIVE to PAID when matching payment arrives", async () => {
      // Metadata generated from the seeded dataset
      linksService.generateMetadata.mockResolvedValue(baseMetadata);

      // Step 3: No payment found yet → ACTIVE
      horizonService.getPayments.mockResolvedValue({
        items: [],
        nextCursor: undefined,
      });

      const statusBefore = await paymentLinkService.getPaymentLinkStatus({
        username: baseMetadata.username as string,
        amount: Number(baseMetadata.amount),
        asset: baseMetadata.asset as string,
        memo: baseMetadata.memo as string,
      });

      expect(statusBefore.state).toBe(LinkState.ACTIVE);
      expect(statusBefore.transactionHash).toBeNull();
      expect(statusBefore.availableActions).toContain("pay");

      // Step 4: Simulate payment arriving on-chain
      horizonService.getPayments.mockResolvedValue({
        items: [paidPaymentItem],
        nextCursor: paidPaymentItem.pagingToken as string,
      });

      const statusAfter = await paymentLinkService.getPaymentLinkStatus({
        username: baseMetadata.username as string,
        amount: Number(baseMetadata.amount),
        asset: baseMetadata.asset as string,
        memo: baseMetadata.memo as string,
      });

      expect(statusAfter.state).toBe(LinkState.PAID);
      expect(statusAfter.transactionHash).toBe(paidPaymentItem.txHash);
      expect(statusAfter.paidAt).toBeInstanceOf(Date);
      expect(statusAfter.userMessage).toContain("completed");
      expect(statusAfter.availableActions).toContain("view_transaction");
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Payment link expires without payment
  // -------------------------------------------------------------------------
  describe("Scenario 2: Payment link expires without payment", () => {
    it("should return EXPIRED when link expires without payment", async () => {
      const expiredMetadata = {
        ...baseMetadata,
        expiresAt: new Date(Date.now() - 86400000), // Yesterday
      };

      linksService.generateMetadata.mockResolvedValue(expiredMetadata);

      horizonService.getPayments.mockResolvedValue({
        items: [],
        nextCursor: undefined,
      });

      const status = await paymentLinkService.getPaymentLinkStatus({
        username: expiredMetadata.username as string,
        amount: Number(expiredMetadata.amount),
      });

      expect(status.state).toBe(LinkState.EXPIRED);
      expect(status.userMessage).toContain("expired");
      expect(status.availableActions).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Username not found
  // -------------------------------------------------------------------------
  describe("Scenario 3: Username not found", () => {
    it("should throw NotFoundException for unknown username", async () => {
      await expect(
        paymentLinkService.getPaymentLinkStatus({
          username: "nonexistent_user",
          amount: 50,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Payment with wrong amount does not match
  // -------------------------------------------------------------------------
  describe("Scenario 4: Payment amount mismatch", () => {
    it("should remain ACTIVE when payment amount does not match", async () => {
      linksService.generateMetadata.mockResolvedValue(baseMetadata);

      // Payment with wrong amount
      horizonService.getPayments.mockResolvedValue({
        items: [
          {
            ...paidPaymentItem,
            amount: "25.0000000", // Wrong amount!
            txHash: "tx_wrong_amount",
          },
        ],
        nextCursor: "tok1",
      });

      const status = await paymentLinkService.getPaymentLinkStatus({
        username: baseMetadata.username as string,
        amount: Number(baseMetadata.amount),
        asset: baseMetadata.asset as string,
        memo: baseMetadata.memo as string,
      });

      expect(status.state).toBe(LinkState.ACTIVE);
      expect(status.transactionHash).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Payment with wrong asset does not match
  // -------------------------------------------------------------------------
  describe("Scenario 5: Payment asset mismatch", () => {
    it("should remain ACTIVE when payment asset does not match", async () => {
      linksService.generateMetadata.mockResolvedValue(baseMetadata);

      // Payment with wrong asset
      horizonService.getPayments.mockResolvedValue({
        items: [
          {
            ...paidPaymentItem,
            asset: "USDC", // Wrong asset!
            txHash: "tx_wrong_asset",
          },
        ],
        nextCursor: "tok1",
      });

      const status = await paymentLinkService.getPaymentLinkStatus({
        username: baseMetadata.username as string,
        amount: Number(baseMetadata.amount),
        asset: baseMetadata.asset as string,
        memo: baseMetadata.memo as string,
      });

      expect(status.state).toBe(LinkState.ACTIVE);
      expect(status.transactionHash).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Expiry sweep marks links expired
  // -------------------------------------------------------------------------
  describe("Scenario 6: Expiry sweep marks expired links", () => {
    it("should mark expired links and emit events", async () => {
      const expiredLink = store.findOne("links", "status", "expired");
      const ownerUser = store.findOne("users", "id", String(expiredLink.user_id));

      const expiredRow: ExpiredPaymentLinkRow = {
        id: String(expiredLink.id),
        owner_public_key: String(ownerUser.public_key),
        destination_public_key: DEST_PUBLIC_KEY,
        amount: String(expiredLink.amount),
        asset_code: String(expiredLink.asset_code),
        memo: String(expiredLink.memo),
        expires_at: new Date(Date.now() - 86400000).toISOString(),
        matched_tx_hash: null,
        matched_at: null,
      };

      paymentLinksRepository.markExpiredLinks.mockResolvedValue([expiredRow]);

      const emitSpy = jest.spyOn(events, "emit");

      const count = await expiryService.runExpirySweep("sweep-run-1");

      expect(count).toBe(1);
      expect(paymentLinksRepository.insertExpiryAudit).toHaveBeenCalledWith(
        expect.objectContaining({ linkId: expiredLink.id }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        "system:expiry-worker",
        "payment_link.expired",
        String(expiredLink.id),
        expect.objectContaining({ runId: "sweep-run-1" }),
      );
      expect(emitSpy).toHaveBeenCalledWith(
        "payment.link.expired",
        expect.objectContaining({ linkId: expiredLink.id }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 7: Horizon failure is handled gracefully
  // -------------------------------------------------------------------------
  describe("Scenario 7: Horizon failure handled gracefully", () => {
    it("should return ACTIVE when Horizon is unavailable", async () => {
      linksService.generateMetadata.mockResolvedValue(baseMetadata);

      // Horizon throws
      horizonService.getPayments.mockRejectedValue(new Error("Horizon down"));

      const status = await paymentLinkService.getPaymentLinkStatus({
        username: baseMetadata.username as string,
        amount: Number(baseMetadata.amount),
        asset: baseMetadata.asset as string,
        memo: baseMetadata.memo as string,
      });

      // Should assume not paid when Horizon is down
      expect(status.state).toBe(LinkState.ACTIVE);
      expect(status.transactionHash).toBeNull();
    });
  });
});