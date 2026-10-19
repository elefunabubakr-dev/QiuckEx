import appJson from './app.json';
import { execSync } from 'child_process';

const defaultEnvironment = process.env.CI ? 'production' : 'dev';
const appEnv = process.env.APP_ENV ?? defaultEnvironment;
const stellarNetwork = process.env.STELLAR_NETWORK ?? (appEnv === 'production' ? 'mainnet' : 'testnet');
const buildNumber = process.env.BUILD_NUMBER ?? process.env.GITHUB_RUN_NUMBER ?? '1';
const androidVersionCode = Number(process.env.ANDROID_VERSION_CODE ?? buildNumber);
const buildTag = process.env.GIT_TAG ?? process.env.GITHUB_REF_NAME ?? '';

// Capture commit SHA from CI (GITHUB_SHA) or local git (rev-parse HEAD)
// Falls back to 'local-dev' for non-git environments
let gitCommitSha = process.env.GITHUB_SHA;
if (!gitCommitSha) {
  try {
    gitCommitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch (e) {
    gitCommitSha = 'local-dev';
  }
}
// Use short commit hash (first 7 characters) for display
const gitCommitShort = gitCommitSha.length > 7 ? gitCommitSha.substring(0, 7) : gitCommitSha;

function appName(env: string): string {
  switch (env) {
    case 'production':
      return 'QuickEx';
    case 'staging':
      return 'QuickEx Staging';
    default:
      return 'QuickEx Dev';
  }
}

function bundleIdentifier(env: string): string {
  switch (env) {
    case 'production':
      return 'to.quickex.app';
    case 'staging':
      return 'to.quickex.app.staging';
    default:
      return 'to.quickex.app.dev';
  }
}

function androidPackage(env: string): string {
  switch (env) {
    case 'production':
      return 'to.quickex.app';
    case 'staging':
      return 'to.quickex.app.staging';
    default:
      return 'to.quickex.app.dev';
  }
}

function apiUrl(env: string): string {
  switch (env) {
    case 'production':
      return 'https://api.quickex.to';
    case 'staging':
      return 'https://staging-api.quickex.to';
    default:
      return process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
  }
}

export default ({ config }: { config: any }) => ({
  ...appJson,
  expo: {
    ...appJson.expo,
    name: appName(appEnv),
    extra: {
      ...appJson.expo.extra,
      apiUrl: apiUrl(appEnv),
      environment: appEnv,
      stellarNetwork,
      buildNumber,
      buildTag,
      gitCommit: gitCommitShort,
      appVersion: appJson.expo.version,
    },
    ios: {
      ...appJson.expo.ios,
      bundleIdentifier: bundleIdentifier(appEnv),
      buildNumber,
      infoPlist: {
        ...appJson.expo.ios.infoPlist,
      },
    },
    android: {
      ...appJson.expo.android,
      package: androidPackage(appEnv),
      versionCode: androidVersionCode,
      intentFilters: appJson.expo.android.intentFilters,
    },
  },
});
