import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import type { RateLimitTier } from "../../config/rate-limit.config";
import {
  RATE_LIMIT_TIER_METADATA_KEY,
} from "../../config/rate-limit.config";

import { HealthController } from "../../health/health.controller";
import { UsernamesController } from "../../usernames/usernames.controller";
import { ManifestsController } from "../../manifests/manifests.controller";
import { MarketplaceController } from "../../marketplace/marketplace.controller";
import { ExportsController } from "../../exports/exports.controller";
import { AnalyticsController } from "../../analytics/analytics.controller";
import { StellarController } from "../../stellar/stellar.controller";
import { AssetMetadataController } from "../../asset-metadata/asset-metadata.controller";
import { TransactionsController } from "../../transactions/transactions.controller";
import { PaymentLinkController } from "../../links/payment-link.controller";
import { LinksController } from "../../links/links.controller";
import { BulkPaymentLinksController } from "../../links/bulk-payment-links.controller";
import { RecurringPaymentsController } from "../../links/recurring-payments.controller";
import { DeveloperController } from "../../developer/developer.controller";
import { ContractRegistryController } from "../../contracts/contract-registry.controller";
import { ContractSpecController } from "../../contracts/contract-spec.controller";
import { ContractViewsController } from "../../contracts/views/contract-views.controller";
import { ContractChangeWebhooksController } from "../../contracts/contract-change-webhooks.controller";
import { DeploymentArtifactsController } from "../../contracts/deployment-artifacts.controller";
import { ContractAllowlistController } from "../../contracts/contract-allowlist.controller";
import { SmokeScenariosController } from "../../contracts/smoke-scenarios/smoke-scenarios.controller";
import { BranchPreviewController } from "../../branch-preview/branch-preview.controller";
import { WebhooksController } from "../../notifications/webhooks.controller";
import { NotificationsController } from "../../notifications/notifications.controller";
import { NotificationPreferencesController } from "../../notifications/notification-preferences.controller";
import { TelegramController } from "../../notifications/telegram/telegram.controller";
import { TemplatesController } from "../../notifications/template-versioning/templates.controller";
import { BranchDeploymentController } from "../../deployment-sync/deployment-sync.controller";
import { SeedResetController } from "../../demos/seed-reset.controller";
import { DemoController } from "../../demos/demo.controller";
import { ApiKeysController } from "../../api-keys/api-keys.controller";
import { AuditController } from "../../audit/audit.controller";
import { AbuseSignalController } from "../../abuse-signals/abuse-signal.controller";
import { NetworkController } from "../../config/network.controller";
import { FeatureFlagsController } from "../../feature-flags/feature-flags.controller";
import { MetricsController } from "../../metrics/metrics.controller";
import { DashboardFeedController } from "../../dashboard-feed/dashboard-feed.controller";
import { SorobanIndexerController } from "../../ingestion/soroban-indexer.controller";
import { JobAdminController } from "../../job-queue/job-admin.controller";
import { EnvironmentParityController } from "../../environment-parity/environment-parity.controller";
import { CrashReportingController } from "../../crash-reporting/crash-reporting.controller";
import { FiatRampsController } from "../../fiat-ramps/fiat-ramps.controller";
import { SupportBundleController } from "../../support-bundle/support-bundle.controller";
import { SupportBundleReferenceController } from "../../support-bundle/support-bundle-reference.controller";
import { OperationsController } from "../../operations/operations.controller";
import { PaymentsController } from "../../payments/payments.controller";
import { RcValidationController } from "../../rc-validation/rc-validation.controller";
import { ReceiptsController } from "../../receipts/receipts.controller";
import { ReconciliationController } from "../../reconciliation/reconciliation.controller";
import { RefundsController } from "../../refunds/refunds.controller";
import { RuntimeConfigController } from "../../runtime-config/runtime-config.controller";
import { ScamAlertsController } from "../../scam-alerts/scam-alerts.controller";
import { PrivacyController } from "../../privacy/privacy.controller";
import { PrivacyAdminController } from "../../privacy/privacy-admin.controller";
import { SorobanToolingController } from "../../soroban-tooling/soroban-tooling.controller";
import { TransactionTimelineController } from "../../transaction-timeline/transaction-timeline.controller";

const ALL_CONTROLLERS: Array<{ name: string; target: unknown }> = [
  { name: "HealthController", target: HealthController },
  { name: "UsernamesController", target: UsernamesController },
  { name: "ManifestsController", target: ManifestsController },
  { name: "MarketplaceController", target: MarketplaceController },
  { name: "ExportsController", target: ExportsController },
  { name: "AnalyticsController", target: AnalyticsController },
  { name: "StellarController", target: StellarController },
  { name: "AssetMetadataController", target: AssetMetadataController },
  { name: "TransactionsController", target: TransactionsController },
  { name: "PaymentLinkController", target: PaymentLinkController },
  { name: "LinksController", target: LinksController },
  { name: "BulkPaymentLinksController", target: BulkPaymentLinksController },
  { name: "RecurringPaymentsController", target: RecurringPaymentsController },
  { name: "DeveloperController", target: DeveloperController },
  { name: "ContractRegistryController", target: ContractRegistryController },
  { name: "ContractSpecController", target: ContractSpecController },
  { name: "ContractViewsController", target: ContractViewsController },
  { name: "ContractChangeWebhooksController", target: ContractChangeWebhooksController },
  { name: "DeploymentArtifactsController", target: DeploymentArtifactsController },
  { name: "ContractAllowlistController", target: ContractAllowlistController },
  { name: "SmokeScenariosController", target: SmokeScenariosController },
  { name: "BranchPreviewController", target: BranchPreviewController },
  { name: "WebhooksController", target: WebhooksController },
  { name: "NotificationsController", target: NotificationsController },
  { name: "NotificationPreferencesController", target: NotificationPreferencesController },
  { name: "TelegramController", target: TelegramController },
  { name: "TemplatesController", target: TemplatesController },
  { name: "BranchDeploymentController", target: BranchDeploymentController },
  { name: "SeedResetController", target: SeedResetController },
  { name: "DemoController", target: DemoController },
  { name: "ApiKeysController", target: ApiKeysController },
  { name: "AuditController", target: AuditController },
  { name: "AbuseSignalController", target: AbuseSignalController },
  { name: "NetworkController", target: NetworkController },
  { name: "FeatureFlagsController", target: FeatureFlagsController },
  { name: "MetricsController", target: MetricsController },
  { name: "DashboardFeedController", target: DashboardFeedController },
  { name: "SorobanIndexerController", target: SorobanIndexerController },
  { name: "JobAdminController", target: JobAdminController },
  { name: "EnvironmentParityController", target: EnvironmentParityController },
  { name: "CrashReportingController", target: CrashReportingController },
  { name: "FiatRampsController", target: FiatRampsController },
  { name: "SupportBundleController", target: SupportBundleController },
  { name: "SupportBundleReferenceController", target: SupportBundleReferenceController },
  { name: "OperationsController", target: OperationsController },
  { name: "PaymentsController", target: PaymentsController },
  { name: "RcValidationController", target: RcValidationController },
  { name: "ReceiptsController", target: ReceiptsController },
  { name: "ReconciliationController", target: ReconciliationController },
  { name: "RefundsController", target: RefundsController },
  { name: "RuntimeConfigController", target: RuntimeConfigController },
  { name: "ScamAlertsController", target: ScamAlertsController },
  { name: "PrivacyController", target: PrivacyController },
  { name: "PrivacyAdminController", target: PrivacyAdminController },
  { name: "SorobanToolingController", target: SorobanToolingController },
  { name: "TransactionTimelineController", target: TransactionTimelineController },
];

type RouteInfo = {
  controllerName: string;
  controllerPath: string;
  handlerName: string;
  handlerPath: string;
  httpMethod: string;
  assignedTier: RateLimitTier | undefined;
};

function getAllRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const { name: controllerName, target } of ALL_CONTROLLERS) {
    const controllerClass = target as new (...args: unknown[]) => unknown;
    const controllerPath =
      (Reflect.getMetadata(PATH_METADATA, controllerClass) as string) ?? "";

    const classTier = Reflect.getMetadata(
      RATE_LIMIT_TIER_METADATA_KEY,
      controllerClass,
    ) as RateLimitTier | undefined;

    const proto = controllerClass.prototype;
    const methodNames = Object.getOwnPropertyNames(proto).filter(
      (m) => m !== "constructor" && typeof proto[m] === "function",
    );

    for (const methodName of methodNames) {
      const handler = proto[methodName];
      const handlerPath = Reflect.getMetadata(PATH_METADATA, handler) as
        | string
        | undefined;
      const httpMethodNum = Reflect.getMetadata(METHOD_METADATA, handler) as
        | number
        | undefined;

      if (handlerPath === undefined || httpMethodNum === undefined) continue;

      const handlerTier = Reflect.getMetadata(
        RATE_LIMIT_TIER_METADATA_KEY,
        handler,
      ) as RateLimitTier | undefined;

      routes.push({
        controllerName,
        controllerPath: Array.isArray(controllerPath)
          ? controllerPath.join(" | ")
          : controllerPath,
        handlerName: methodName,
        handlerPath,
        httpMethod: RequestMethod[httpMethodNum] ?? "UNKNOWN",
        assignedTier: handlerTier ?? classTier,
      });
    }
  }

  return routes;
}

describe("Rate limit tier assignment (public surface)", () => {
  const VALID_TIERS: ReadonlySet<RateLimitTier> = new Set<RateLimitTier>([
    "public-read",
    "search",
    "mutation",
    "export",
  ]);

  const routes = getAllRoutes();

  it("has discovered at least one route (sanity check)", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  describe.each(routes)(
    "$httpMethod $controllerPath/$handlerPath ($controllerName.$handlerName)",
    (route) => {
      it("has a valid rate limit tier assigned", () => {
        expect(route.assignedTier).toBeDefined();
        expect(VALID_TIERS.has(route.assignedTier!)).toBe(true);
      });
    },
  );

  it("summarizes uncovered routes if any", () => {
    const unassigned = routes.filter((r) => !r.assignedTier);
    if (unassigned.length > 0) {
      const report = unassigned
        .map(
          (r) =>
            `  - [${r.httpMethod}] ${r.controllerPath}/${r.handlerPath} (${r.controllerName}.${r.handlerName})`,
        )
        .join("\n");
      // eslint-disable-next-line no-console
      console.error(
        `\n[rate-limit-tier-test] Missing tiers for ${unassigned.length} route(s):\n${report}\n`,
      );
    }
    expect(unassigned).toEqual([]);
  });
});
