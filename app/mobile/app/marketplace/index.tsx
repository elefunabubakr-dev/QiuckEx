import { useRouter } from "expo-router";
import React, { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useMarketplace } from "../../hooks/useMarketplace";
import { useTheme } from "../../src/theme/ThemeContext";
import { type MarketplaceListing, formatPublicKey } from "../../services/marketplace";
import type { ThemeTokens } from "../../src/theme/tokens";

export default function MarketplaceScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { state, refresh, loadMore } = useMarketplace({ sort: "newest" });

  const handlePress = useCallback(
    (listing: MarketplaceListing) => {
      router.push({
        pathname: "/marketplace/[id]",
        params: { id: listing.id },
      });
    },
    [router],
  );

  const isRefreshing = state.status === "loading";

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Marketplace</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          Browse username listings
        </Text>
      </View>

      {state.status === "loading" && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.stateText, { color: theme.textSecondary }]}>
            Loading listings…
          </Text>
        </View>
      )}

      {state.status === "error" && (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: theme.status.error }]}>
            {state.error}
          </Text>
          <Pressable
            style={[styles.retryButton, { backgroundColor: theme.buttonPrimaryBg }]}
            onPress={() => void refresh()}
          >
            <Text style={[styles.retryText, { color: theme.buttonPrimaryText }]}>
              Retry
            </Text>
          </Pressable>
        </View>
      )}

      {state.status === "success" && (
        <FlatList
          data={state.listings}
          keyExtractor={(item: MarketplaceListing) => item.id}
          contentContainerStyle={
            state.listings.length === 0 ? styles.emptyContainer : styles.listContent
          }
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => void refresh()}
              tintColor={theme.primary}
            />
          }
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.stateText, { color: theme.textSecondary }]}>
                No listings available right now.
              </Text>
            </View>
          }
          ListFooterComponent={
            state.loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator size="small" color={theme.primary} />
              </View>
            ) : null
          }
          renderItem={({ item }: { item: MarketplaceListing }) => (
            <ListingRow listing={item} onPress={handlePress} theme={theme} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

type Theme = ThemeTokens;

function ListingRow({
  listing,
  onPress,
  theme,
}: {
  listing: MarketplaceListing;
  onPress: (l: MarketplaceListing) => void;
  theme: Theme;
}) {
  const statusLabel =
    listing.status === "active"
      ? "Active"
      : listing.status === "sold"
      ? "Sold"
      : "Cancelled";

  const statusColor =
    listing.status === "active"
      ? theme.status.success
      : listing.status === "sold"
      ? theme.status.warning ?? theme.textSecondary
      : theme.status.error;

  return (
    <Pressable
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
      onPress={() => onPress(listing)}
      accessibilityRole="button"
      accessibilityLabel={`View listing for @${listing.username}`}
    >
      <View style={styles.cardTop}>
        <Text style={[styles.username, { color: theme.textPrimary }]}>
          @{listing.username}
        </Text>
        <View style={[styles.statusBadge, { borderColor: statusColor }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.cardMeta}>
        <View style={styles.metaItem}>
          <Text style={[styles.metaLabel, { color: theme.textMuted }]}>Asking price</Text>
          <Text style={[styles.metaValue, { color: theme.textPrimary }]}>
            {listing.asking_price.toLocaleString()} USDC
          </Text>
        </View>
        {listing.bid_count !== undefined && (
          <View style={styles.metaItem}>
            <Text style={[styles.metaLabel, { color: theme.textMuted }]}>Bids</Text>
            <Text style={[styles.metaValue, { color: theme.textPrimary }]}>
              {listing.bid_count}
            </Text>
          </View>
        )}
        <View style={styles.metaItem}>
          <Text style={[styles.metaLabel, { color: theme.textMuted }]}>Seller</Text>
          <Text style={[styles.metaValue, { color: theme.textSecondary }]}>
            {formatPublicKey(listing.seller_public_key)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
  },
  subtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 32,
  },
  emptyContainer: {
    flexGrow: 1,
  },
  listContent: {
    padding: 16,
    gap: 12,
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
  footer: {
    paddingVertical: 16,
    alignItems: "center",
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  username: {
    fontSize: 20,
    fontWeight: "700",
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
  cardMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
  },
  metaItem: {
    gap: 2,
  },
  metaLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  metaValue: {
    fontSize: 14,
    fontWeight: "600",
  },
});
