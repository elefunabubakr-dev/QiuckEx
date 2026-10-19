import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../src/theme/ThemeContext';
import {
  formatEnvironment,
  formatNetwork,
  getBuildMetadata,
  getMetadataLabel,
  type BuildMetadata,
} from '../src/utils/build-metadata';
import { copyToClipboard } from '../src/utils/clipboard';

type MetadataField = {
  key: keyof BuildMetadata;
  label: string;
  value: string;
};

/**
 * Routed build diagnostics used by app/settings.tsx.
 *
 * This is the supported replacement for the legacy src/components version that
 * was only reachable from the dead src/screens/SettingsScreen tree.
 */
export function BuildMetadataPanel() {
  const { theme } = useTheme();
  const [copiedKey, setCopiedKey] = useState<keyof BuildMetadata | 'all' | null>(null);
  const metadata = useMemo(() => getBuildMetadata(), []);

  const fields = useMemo<MetadataField[]>(
    () => [
      {
        key: 'appVersion',
        label: getMetadataLabel('appVersion'),
        value: metadata.appVersion,
      },
      {
        key: 'buildNumber',
        label: getMetadataLabel('buildNumber'),
        value: metadata.buildNumber,
      },
      {
        key: 'buildMetadata',
        label: getMetadataLabel('buildMetadata'),
        value: metadata.buildMetadata,
      },
      {
        key: 'gitBranch',
        label: getMetadataLabel('gitBranch'),
        value: metadata.gitBranch,
      },
      {
        key: 'gitCommit',
        label: getMetadataLabel('gitCommit'),
        value: metadata.gitCommit,
      },
      {
        key: 'environment',
        label: getMetadataLabel('environment'),
        value: formatEnvironment(metadata.environment),
      },
      {
        key: 'network',
        label: getMetadataLabel('network'),
        value: formatNetwork(metadata.network),
      },
    ],
    [metadata],
  );

  const markCopied = (key: keyof BuildMetadata | 'all') => {
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
    }, 2000);
  };

  const handleCopy = async (field: MetadataField) => {
    const success = await copyToClipboard(field.value);
    if (!success) {
      Alert.alert('Copy failed', `Unable to copy ${field.label.toLowerCase()}.`);
      return;
    }
    markCopied(field.key);
  };

  const handleCopyAll = async () => {
    const text = fields.map((field) => `${field.label}: ${field.value}`).join('\n');
    const success = await copyToClipboard(text);
    if (!success) {
      Alert.alert('Copy failed', 'Unable to copy build metadata.');
      return;
    }
    markCopied('all');
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={styles.headingGroup}>
        <Text
          style={[styles.title, { color: theme.textPrimary }]}
          accessibilityRole="header"
        >
          Build Metadata
        </Text>
        <Text style={[styles.helper, { color: theme.textMuted }]}> 
          Tap any field to copy it. Include this information when reporting a
          build-specific issue.
        </Text>
      </View>

      {fields.map((field) => {
        const copied = copiedKey === field.key;
        return (
          <Pressable
            key={field.key}
            style={styles.row}
            onPress={() => {
              void handleCopy(field);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${field.label}: ${field.value}. ${copied ? 'Copied.' : 'Tap to copy.'}`}
            accessibilityHint={`Copies ${field.label.toLowerCase()} to the clipboard`}
          >
            <Text style={[styles.label, { color: theme.textPrimary }]}>
              {field.label}
            </Text>
            <Text
              style={[
                styles.value,
                { color: copied ? theme.buttonPrimaryBg : theme.textMuted },
              ]}
              numberOfLines={2}
            >
              {copied ? 'Copied' : field.value}
            </Text>
          </Pressable>
        );
      })}

      <Pressable
        style={[styles.copyAllButton, { backgroundColor: theme.buttonPrimaryBg }]}
        onPress={() => {
          void handleCopyAll();
        }}
        accessibilityRole="button"
        accessibilityLabel={`${copiedKey === 'all' ? 'All build metadata copied.' : 'Copy all build metadata.'}`}
        accessibilityHint="Copies version, build, git, environment and network information to the clipboard"
      >
        <Text style={[styles.copyAllText, { color: theme.buttonPrimaryText }]}> 
          {copiedKey === 'all' ? 'Copied All Metadata' : 'Copy All Metadata'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    gap: 12,
  },
  headingGroup: {
    gap: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  helper: {
    fontSize: 13,
    lineHeight: 18,
  },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  value: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'right',
    fontFamily: 'monospace',
  },
  copyAllButton: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  copyAllText: {
    fontSize: 14,
    fontWeight: '700',
  },
});

export default BuildMetadataPanel;
