import React, { createContext, useContext, useMemo } from 'react';

export type StellarNetwork = 'testnet' | 'mainnet';

export type EnvironmentName = 'production' | 'staging' | 'testnet' | 'br';

export type Environment = {
  name: EnvironmentName;
  stellarNetwork: StellarNetwork;
  isDevelopment: boolean;
};

type EnvironmentContextValue = {
  current: Environment;
};

const EnvironmentContext = createContext<EnvironmentContextValue | undefined>(undefined);

const DEFAULT_ENVIRONMENT: Environment = {
  name: 'testnet',
  stellarNetwork: 'testnet',
  isDevelopment: true,
};

function normalizeEnvironmentName(value?: string): EnvironmentName | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'production') return 'production';
  if (normalized === 'staging') return 'staging';
  if (normalized === 'testnet') return 'testnet';
  if (normalized === 'br' || normalized === 'preview' || normalized === 'br_preview') {
    return 'br';
  }
  return undefined;
}

export function resolveEnvironment(
  env: Record<string, string | undefined> = process.env,
): Environment {
  const rawName =
    env.EXPO_PUBLIC_ENV ??
    env.REACT_APP_ENV ??
    env.APP_ENV ??
    env.ENVIRONMENT ??
    env.NODE_ENV;
  const name = (normalizeEnvironmentName(rawName) ?? 'development') as EnvironmentName;

  const isProduction = name === 'production';

  return {
    name,
    stellarNetwork: isProduction ? 'mainnet' : 'testnet',
    isDevelopment: !env.EXPO_PUBLIC_ENV && !env.REACT_APP_ENV,
  };
}

export function EnvironmentProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value?: Environment;
}) {
  const current = value ?? resolveEnvironment();
  const contextValue = useMemo(() => ({ current }), [current]);

  return (
    <EnvironmentContext.Provider value={contextValue}>{children}</EnvironmentContext.Provider>
  );
}

export function useEnvironment(): EnvironmentContextValue {
  const context = useContext(EnvironmentContext);
  if (!context) {
    throw new Error('useEnvironment must be used within an EnvironmentProvider');
  }
  return context;
}

export const __internal = {
  normalizeEnvironmentName,
  DEFAULT_ENVIRONMENT,
};
