import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { WalletSwitchHelpModal } from './components/WalletSwitchHelpModal';

export interface NetworkMismatchGuardProps {
  children: React.ReactNode;
  onBlocked?: () => void;
  currentNetwork?: string;
  requiredNetwork?: string;
}

export const NetworkMismatchGuard: React.FC<NetworkMismatchGuardProps> = ({
  children,
  onBlocked,
  currentNetwork = 'MAINNET',
  requiredNetwork = 'TESTNET',
}) => {
  const mismatch = currentNetwork !== requiredNetwork;

  if (!mismatch) {
    return <>{children}</>;
  }

  return (
    <View style={styles.container}>
      <Pressable
        onPress={onBlocked}
        style={styles.badge}
        testID="action-blocked-badge"
        accessibilityRole="button"
        accessibilityLabel="Action Blocked"
      >
        <Text style={styles.badgeText}>Action Blocked</Text>
      </Pressable>
      <Text style={styles.hint}>
        Tap the badge for help switching networks.
      </Text>
    </View>
  );
};

export default function PaymentConfirmationScreen() {
  const [showHelpModal, setShowHelpModal] = useState(false);
  const currentNetwork = 'MAINNET';
  const requiredNetwork = 'TESTNET';

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Confirm Payment</Text>
      <NetworkMismatchGuard
        currentNetwork={currentNetwork}
        requiredNetwork={requiredNetwork}
        onBlocked={() => setShowHelpModal(true)}
      >
        <Text style={styles.body}>Payment details</Text>
      </NetworkMismatchGuard>
      <WalletSwitchHelpModal
        visible={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        currentNetwork={currentNetwork}
        requiredNetwork={requiredNetwork}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  body: {
    fontSize: 14,
  },
  container: {
    alignItems: 'flex-start',
  },
  badge: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#ffedcc',
  },
  badgeText: {
    color: '#92400',
    fontWeight: '600',
  },
  hint: {
    marginTop: 8,
    color: '#666666',
    fontSize: 12,
  },
});
