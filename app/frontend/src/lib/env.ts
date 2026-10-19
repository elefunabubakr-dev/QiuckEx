/**
 * Frontend environment variable validation.
 * Ensures all required variables are present at build/startup time.
 */

// Define required environment variables
const requiredEnvVars = [
  "NEXT_PUBLIC_QUICKEX_API_URL",
  "NEXT_PUBLIC_STELLAR_NETWORK",
] as const;

/**
 * Resolved runtime configuration. Every value must be read through a *static*
 * `process.env.NEXT_PUBLIC_*` reference: Next.js inlines literal references
 * into the client bundle at build time, but a dynamic read such as
 * `process.env[key]` is left untouched and always returns `undefined` in a
 * browser (webpack's `process.env` shim is empty). Reading dynamically made
 * EnvGuard reject every route with a "Configuration Error" page in any built
 * app (dev or production) — fixed as part of FE-56.
 */
function resolveEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_QUICKEX_API_URL: process.env.NEXT_PUBLIC_QUICKEX_API_URL,
    NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_ERROR_REPORTING_ENABLED:
      process.env.NEXT_PUBLIC_ERROR_REPORTING_ENABLED,
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
  };
}

type RequiredEnvVar = typeof requiredEnvVars[number];

/**
 * Link to the runtime configuration documentation, surfaced on the
 * misconfiguration page for remediation guidance.
 */
export const RUNTIME_CONFIG_DOCS_URL =
  "https://github.com/Pulsefy/QiuckEx/blob/main/docs/RUNTIME-CONFIG-MATRIX.md";

/**
 * Human-readable specification for each known configuration key. Only key
 * names and their *expected shape* are described here — never actual values —
 * so the misconfiguration page can guide contributors without leaking secrets.
 */
export type EnvKeySpec = {
  /** Short description of what the variable is for. */
  description: string;
  /** Expected shape or allowed values (no real secrets/tokens). */
  expected: string;
};

export const ENV_SPEC: Record<string, EnvKeySpec> = {
  NEXT_PUBLIC_QUICKEX_API_URL: {
    description: "Base URL of the QuickEx API the frontend talks to.",
    expected: "A valid absolute URL, e.g. https://api.quickex.example",
  },
  NEXT_PUBLIC_STELLAR_NETWORK: {
    description: "Target Stellar network for links and payments.",
    expected: 'One of "testnet" or "mainnet"',
  },
};

/** Look up the expected-shape spec for a configuration key, if known. */
export function getEnvKeySpec(key: string): EnvKeySpec | undefined {
  return ENV_SPEC[key];
}

// Validate environment variables
export function validateEnv() {
  const env = resolveEnv();
  const missing: RequiredEnvVar[] = [];
  const invalid: { key: string; reason: string }[] = [];

  // Check required variables
  for (const key of requiredEnvVars) {
    const value = env[key];
    if (!value || value.trim() === "") {
      missing.push(key);
    }
  }

  // Validate NEXT_PUBLIC_STELLAR_NETWORK
  const network = env.NEXT_PUBLIC_STELLAR_NETWORK;
  if (network && !["testnet", "mainnet"].includes(network.toLowerCase())) {
    invalid.push({
      key: "NEXT_PUBLIC_STELLAR_NETWORK",
      reason: `Must be either "testnet" or "mainnet", got "${network}"`,
    });
  }

  // Validate NEXT_PUBLIC_QUICKEX_API_URL is a valid URL
  const apiUrl = env.NEXT_PUBLIC_QUICKEX_API_URL;
  if (apiUrl) {
    try {
      new URL(apiUrl);
    } catch {
      invalid.push({
        key: "NEXT_PUBLIC_QUICKEX_API_URL",
        reason: `Must be a valid URL, got "${apiUrl}"`,
      });
    }
  }

  return { missing, invalid, isValid: missing.length === 0 && invalid.length === 0 };
}

// Get validated environment variables
export function getEnv() {
  const env = resolveEnv();
  const validation = validateEnv();
  if (!validation.isValid) {
    console.error("Environment validation failed:", {
      missing: validation.missing,
      invalid: validation.invalid,
    });
  }
  return {
    NEXT_PUBLIC_QUICKEX_API_URL: env.NEXT_PUBLIC_QUICKEX_API_URL!,
    NEXT_PUBLIC_STELLAR_NETWORK: env.NEXT_PUBLIC_STELLAR_NETWORK! as "testnet" | "mainnet",
    NEXT_PUBLIC_SITE_URL: env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_ERROR_REPORTING_ENABLED: env.NEXT_PUBLIC_ERROR_REPORTING_ENABLED,
    NEXT_PUBLIC_APP_VERSION: env.NEXT_PUBLIC_APP_VERSION,
  };
}
