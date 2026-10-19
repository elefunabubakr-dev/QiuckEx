import { APP_VERSION, BUILD_NUMBER, APP_ENVIRONMENT, STELLAR_NETWORK, BUILD_TAG, GIT_COMMIT, BUILD_METADATA } from '../config/build';

export interface BuildMetadata {
  appVersion: string;
  buildNumber: string;
  gitBranch: string;
  gitCommit: string;
  environment: string;
  network: string;
  buildMetadata: string;
}

/**
 * Get build metadata for display in settings
 * Git branch is extracted from BUILD_TAG, commit SHA is read from GIT_COMMIT
 */
export function getBuildMetadata(): BuildMetadata {
  // Extract branch from BUILD_TAG or use fallback
  const gitBranch = BUILD_TAG || 'Unknown';
  // Use the pre-extracted commit SHA from app.config.ts
  const gitCommit = GIT_COMMIT;

  return {
    appVersion: APP_VERSION,
    buildNumber: BUILD_NUMBER,
    gitBranch,
    gitCommit,
    environment: APP_ENVIRONMENT,
    network: STELLAR_NETWORK,
    buildMetadata: BUILD_METADATA,
  };
}

/**
 * Format environment for display
 */
export function formatEnvironment(env: string): string {
  switch (env) {
    case 'production':
      return 'Production';
    case 'staging':
      return 'Staging';
    case 'dev':
      return 'Development';
    default:
      return env.charAt(0).toUpperCase() + env.slice(1);
  }
}

/**
 * Format network for display
 */
export function formatNetwork(network: string): string {
  return network.charAt(0).toUpperCase() + network.slice(1);
}

/**
 * Get a human-readable label for a metadata field
 */
export function getMetadataLabel(key: keyof BuildMetadata): string {
  const labels: Record<keyof BuildMetadata, string> = {
    appVersion: 'App Version',
    buildNumber: 'Build Number',
    gitBranch: 'Git Branch',
    gitCommit: 'Git Commit',
    environment: 'Environment',
    network: 'Network',
    buildMetadata: 'Build Metadata',
  };
  return labels[key];
}
