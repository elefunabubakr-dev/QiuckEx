import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';

export interface WalletSwitchHelpModalProps {
  visible: boolean;
  onClose: () => void;
  currentNetwork?: string;
  requiredNetwork?: string;
}

export const WalletSwitchHelpModal: React.FC<WalletSwitchHelpModalProps> = ({
  visible,
  onClose,
  currentNetwork = 'MAINNET',
  requiredNetwork = 'TESTNET',
}) => {
  const message = `Your wallet is on ${currentNetwork} but this action requires ${requiredNetwork}.`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="wallet-switch-help-modal"
    >
      <View style={styles.overlay}>
        <View style={styles.content}>
          <Text style={styles.title}>Network Mismatch</Text>
          <Text style={styles.message}>{message}</Text>
          <Text style={styles.guidance}>
            Open your wallet, disconnect from {currentNetwork}, and switch to {requiredNetwork} to continue.
          </Text>
          <Pressable
            style={styles.button}
            onPress={onClose}
            testID="wallet-switch-help-close"
            accessibilityRole="button"
            accessibilityLabel="Close network mismatch help"
          >
            <Text style={styles.buttonText}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  content: {
    width: '85%',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  message: {
    fontSize: 14,
    color: '#333333',
    marginBottom: 8,
  },
  guidance: {
    fontSize: 14,
    color: '#555555',
    marginBottom: 20,
  },
  button: {
    alignSelf: 'flex-end',
    paddinnVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
});

export default WalletSwitchHelpModal;
