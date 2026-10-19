import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useMarketplaceDetail } from "../../hooks/useMarketplaceDetail";
import { useWallet } from "../../hooks/useWallet";
import { useSecurity } from "../../hooks/use-security";
import { useTheme } from "../../src/theme/ThemeContext";
import {
  type MarketplaceBid,
  type MarketplaceListingDetail,
  formatPublicKey,
  fetchMarketplaceListingDetail,
  placeBid,
} from "../../services/marketplace";
import type { ThemeTokens } from "../../src/theme/tokens";

export default function MarketplaceDetailScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { wallet } = useWallet();
  const { state, refresh } = useMarketplaceDetail(id, wallet.publicKey);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Back button */}
      <View style={[styles.navBar, { borderBottomColor: theme.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={[styles.backText, { color: theme.link }]}>← Back</Text>
        </Pressable>
        <Text style={[styles.navTitle, { color: theme.textPrimary }]}>Listing Detail</Text>
        <View style={styles.navRight} />
      </View>

      {state.status === "loading" && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.stateText, { color: theme.textSecondary }]}>
            Loading listing…
          </Text>
        </View>
      )}

      {state.status === "error" && (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: theme.status.error }]}>
            {state.notFound ? "This listing was not found." : state.error}
          </Text>
          {!state.notFound && (
            <Pressable
              style={[styles.retryButton, { backgroundColor: theme.buttonPrimaryBg }]}
              onPress={() => void refresh()}
            >
              <Text style={[styles.retryText, { color: theme.buttonPrimaryText }]}>
                Retry
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {state.status === "success" && (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <DetailContent
            detail={state.detail}
            listingId={id}
            wallet={wallet}
            theme={theme}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

type Theme = ReturnType<typeof useTheme>["theme"];

function DetailContent({
  detail,
  listingId,
  wallet,
  theme,
}: {
  detail: MarketplaceListingDetail;
  listingId: string;
  wallet: ReturnType<typeof useWallet>["wallet"];
  theme: ThemeTokens;
}) {
  const router = useRouter();
  const { authenticateForSensitiveAction } = useSecurity();
  const { listing, seller, state_hints } = detail;
  const [bids, setBids] = React.useState(detail.bids);
  const [bidAmount, setBidAmount] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [bidFeedback, setBidFeedback] = React.useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const statusLabel =
    listing.status === "active" ? "Active" : listing.status === "sold" ? "Sold" : "Cancelled";

  const statusColor =
    listing.status === "active"
      ? theme.status.success
      : listing.status === "sold"
      ? theme.status.warning ?? theme.textSecondary
      : theme.status.error;

  const pendingBids = bids.filter((b) => b.status === "pending");

  return (
    <>
      {/* Header card */}
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.cardTop}>
          <Text style={[styles.username, { color: theme.textPrimary }]}>
            @{listing.username}
          </Text>
          <View style={[styles.statusBadge, { borderColor: statusColor }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>

        <Row label="Asking price" value={`${Number(listing.asking_price).toLocaleString()} USDC`} theme={theme} />

        <Row label="Seller" value={seller.display_key} theme={theme} />

        <Row
          label="Listed"
          value={new Date(listing.created_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
          theme={theme}
        />

        {listing.status === "sold" && listing.sold_at ? (
          <Row
            label="Sold"
            value={new Date(listing.sold_at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
            theme={theme}
          />
        ) : null}

        {listing.status === "sold" && listing.final_price ? (
          <Row
            label="Final price"
            value={`${Number(listing.final_price).toLocaleString()} USDC`}
            theme={theme}
          />
        ) : null}
      </View>

      {/* Availability hints */}
      {listing.status === "active" && (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Availability</Text>
          <Row
            label="Min bid"
            value={`${state_hints.minimum_bid_amount.toLocaleString()} USDC`}
            theme={theme}
          />
          {!state_hints.is_available && state_hints.unavailable_reason ? (
            <Text style={[styles.hint, { color: theme.status.error }]}>
              {state_hints.unavailable_reason}
            </Text>
          ) : null}
          {state_hints.can_place_bid ? (
            <>
              {wallet.connected && wallet.publicKey ? (
                <>
                  <Text style={[styles.bidPrompt, { color: theme.textSecondary }]}>
                    Enter a bid of at least {state_hints.minimum_bid_amount.toLocaleString()} USDC.
                    You&apos;ll authenticate before your bid is submitted.
                  </Text>
                  <TextInput
                    accessibilityLabel="Bid amount in USDC"
                    accessibilityHint={`Enter at least ${state_hints.minimum_bid_amount} USDC`}
                    keyboardType="decimal-pad"
                    value={bidAmount}
                    onChangeText={(value) => {
                      setBidAmount(value);
                      setBidFeedback(null);
                    }}
                    placeholder="Bid amount"
                    placeholderTextColor={theme.textMuted}
                    style={[
                      styles.bidInput,
                      {
                        backgroundColor: theme.inputBg,
                        borderColor: theme.inputBorder,
                        color: theme.inputText,
                      },
                    ]}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isSubmitting }}
                    disabled={isSubmitting}
                    onPress={() => {
                      void (async () => {
                        const amountText = bidAmount.trim();
                        const amount = Number(amountText);
                        const bidderPublicKey = wallet.publicKey;
                        if (!wallet.connected || !bidderPublicKey) {
                          setBidFeedback({
                            type: "error",
                            message: "Connect your wallet before placing a bid.",
                          });
                          return;
                        }

                        if (
                          !amountText ||
                          !/^\d+(?:\.\d+)?$/.test(amountText) ||
                          !Number.isFinite(amount) ||
                          amount < state_hints.minimum_bid_amount ||
                          (amountText.split(".")[1]?.length ?? 0) > 7
                        ) {
                          setBidFeedback({
                            type: "error",
                            message: `Enter a valid bid of at least ${state_hints.minimum_bid_amount.toLocaleString()} USDC (up to 7 decimal places).`,
                          });
                          return;
                        }

                        setIsSubmitting(true);
                        setBidFeedback(null);
                        try {
                          const authorized = await authenticateForSensitiveAction(
                            "payment_authorization",
                          );
                          if (!authorized) {
                            setBidFeedback({
                              type: "error",
                              message: "Authentication was not completed. Your bid was not submitted.",
                            });
                            return;
                          }

                          const bid = await placeBid(listingId, amount, bidderPublicKey);
                          setBids((current) => [bid, ...current]);
                          setBidAmount("");
                          setBidFeedback({
                            type: "success",
                            message: "Your bid was placed successfully.",
                          });
                        } catch (error) {
                          let message =
                            error instanceof Error
                              ? error.message
                              : "Unable to place your bid. Please try again.";
                          try {
                            const latest = await fetchMarketplaceListingDetail(
                              listingId,
                              wallet.publicKey,
                            );
                            setBids(latest.bids);
                          } catch (refreshError) {
                            const refreshMessage =
                              refreshError instanceof Error
                                ? refreshError.message
                                : "Bid history could not be refreshed.";
                            message += ` Bid history refresh failed: ${refreshMessage}`;
                          }
                          setBidFeedback({ type: "error", message });
                        } finally {
                          setIsSubmitting(false);
                        }
                      })();
                    }}
                    style={[
                      styles.submitButton,
                      { backgroundColor: theme.buttonPrimaryBg },
                      isSubmitting && styles.submitButtonDisabled,
                    ]}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator color={theme.buttonPrimaryText} />
                    ) : (
                      <Text style={[styles.submitButtonText, { color: theme.buttonPrimaryText }]}>
                        Place bid
                      </Text>
                    )}
                  </Pressable>
                </>
              ) : (
                <View style={styles.walletPrompt}>
                  <Text style={[styles.bidPrompt, { color: theme.textSecondary }]}>
                    Connect a wallet to place a bid.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push("/wallet-connect")}
                    style={[styles.submitButton, { backgroundColor: theme.buttonPrimaryBg }]}
                  >
                    <Text style={[styles.submitButtonText, { color: theme.buttonPrimaryText }]}>
                      Connect wallet
                    </Text>
                  </Pressable>
                </View>
              )}
              {bidFeedback ? (
                <Text
                  accessibilityRole={bidFeedback.type === "error" ? "alert" : undefined}
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.bidFeedback,
                    {
                      color:
                        bidFeedback.type === "success"
                          ? theme.status.success
                          : theme.status.error,
                    },
                  ]}
                >
                  {bidFeedback.message}
                </Text>
              ) : null}
            </>
          ) : null}
        </View>
      )}

      {/* Bid history */}
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>
          Bid History ({pendingBids.length} active)
        </Text>

        {bids.length === 0 ? (
          <Text style={[styles.emptyBids, { color: theme.textSecondary }]}>
            No bids placed yet.
          </Text>
        ) : (
          bids.map((bid: MarketplaceBid) => (
            <BidRow key={bid.id} bid={bid} theme={theme} />
          ))
        )}
      </View>
    </>
  );
}

function Row({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: ThemeTokens;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.valueText, { color: theme.textSecondary }]}>{value}</Text>
    </View>
  );
}

function BidRow({ bid, theme }: { bid: MarketplaceBid; theme: ThemeTokens }) {
  const statusColors: Record<MarketplaceBid["status"], string> = {
    pending: theme.status.success,
    accepted: theme.primary,
    rejected: theme.status.error,
    cancelled: theme.textMuted,
  };

  return (
    <View style={[styles.bidRow, { borderBottomColor: theme.borderLight ?? theme.border }]}>
      <View style={styles.bidLeft}>
        <Text style={[styles.bidder, { color: theme.textPrimary }]}>
          {formatPublicKey(bid.bidder_public_key)}
        </Text>
        <Text style={[styles.bidDate, { color: theme.textMuted }]}>
          {new Date(bid.created_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </Text>
      </View>
      <View style={styles.bidRight}>
        <Text style={[styles.bidAmount, { color: theme.textPrimary }]}>
          {Number(bid.bid_amount).toLocaleString()} USDC
        </Text>
        <Text style={[styles.bidStatus, { color: statusColors[bid.status] }]}>
          {bid.status.charAt(0).toUpperCase() + bid.status.slice(1)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    paddingVertical: 4,
    paddingRight: 12,
  },
  backText: {
    fontSize: 16,
    fontWeight: "600",
  },
  navTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  navRight: { width: 60 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 32,
  },
  stateText: {
    fontSize: 15,
    textAlign: "center",
  },
  errorText: {
    fontSize: 15,
    textAlign: "center",
  },
  retryButton: {
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  retryText: {
    fontSize: 15,
    fontWeight: "700",
  },
  content: {
    padding: 16,
    gap: 14,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
    marginBottom: 2,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  username: {
    fontSize: 26,
    fontWeight: "800",
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowLabel: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  valueText: {
    fontSize: 15,
    fontWeight: "600",
    textAlign: "right",
    flex: 1,
    marginLeft: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 4,
  },
  hint: {
    fontSize: 13,
  },
  bidPrompt: { fontSize: 13, lineHeight: 19 },
  walletPrompt: { gap: 10 },
  bidInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
  },
  submitButton: {
    minHeight: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  submitButtonDisabled: { opacity: 0.65 },
  submitButtonText: { fontSize: 15, fontWeight: "700" },
  bidFeedback: { fontSize: 13, lineHeight: 18 },
  emptyBids: {
    fontSize: 14,
  },
  bidRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  bidLeft: { gap: 2, flex: 1 },
  bidRight: { alignItems: "flex-end", gap: 2 },
  bidder: {
    fontSize: 14,
    fontWeight: "600",
  },
  bidDate: {
    fontSize: 12,
  },
  bidAmount: {
    fontSize: 15,
    fontWeight: "700",
  },
  bidStatus: {
    fontSize: 12,
    fontWeight: "600",
  },
});
