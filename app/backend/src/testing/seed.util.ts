/**
 * Seeding utility for the backend integration test suite (BE-127).
 *
 * Provides idempotent `seedDatabase` / `cleanDatabase` / `resetDatabase`
 * operations against a minimal database client. Tests running without a live
 * database can back the client with `createInMemorySeedStore`; tests wired to
 * Supabase can hand the real client in and use the exact same operations.
 */
import {
  createSeedFixtures,
  type CreateSeedFixturesOptions,
  type SeedFixtures,
} from './seed-data.fixtures';

export interface SeedQueryError {
  message: string;
}

export interface SeedQueryResult<T> {
  data: T | null;
  error: SeedQueryError | null;
}

export interface SeedDeleteBuilder {
  in(column: string, values: unknown[]): Promise<SeedQueryResult<unknown[]>>;
  eq(column: string, value: unknown): Promise<SeedQueryResult<unknown[]>>;
}

export interface SeedTableClient {
  select(columns?: string): Promise<SeedQueryResult<unknown[]>>;
  insert(rows: Record<string, unknown>[]): Promise<SeedQueryResult<unknown[]>>;
  upsert(rows: Record<string, unknown>[]): Promise<SeedQueryResult<unknown[]>>;
  delete(): SeedDeleteBuilder;
}

/** Minimal client shape required by the seeding operations. */
export interface SeedClient {
  from(table: string): SeedTableClient;
}

export type SeedableTable = keyof SeedFixtures;

export const SEED_TABLES: SeedableTable[] = [
  'users',
  'usernames',
  'links',
  'transactions',
  'receipts',
];

export interface SeedDatabaseOptions extends CreateSeedFixturesOptions {
  /** Restrict seeding/cleaning to these tables (defaults to all of them). */
  tables?: SeedableTable[];
}

function tableRows(
  fixtures: SeedFixtures,
): Record<SeedableTable, Record<string, unknown>[]> {
  return {
    users: fixtures.users.map((row) => ({ ...row })),
    usernames: fixtures.usernames.map((row) => ({ ...row })),
    links: fixtures.links.map((row) => ({ ...row })),
    transactions: fixtures.transactions.map((row) => ({ ...row })),
    receipts: fixtures.receipts.map((row) => ({ ...row })),
  };
}

function throwOnError(table: string, operation: string, error: SeedQueryError | null): void {
  if (error) {
    throw new Error(`Failed to ${operation} ${table}: ${error.message}`);
  }
}

/**
 * Seeds a known, deterministic dataset into the target client.
 *
 * Idempotent: running twice yields the same rows. Returns the canonical
 * fixtures so tests can wire mocked repositories/services straight from data
 * they actually seeded.
 */
export async function seedDatabase(
  client: SeedClient,
  options: SeedDatabaseOptions = {},
): Promise<SeedFixtures> {
  const fixtures = createSeedFixtures(options);
  const rowsByTable = tableRows(fixtures);
  const tables = options.tables ?? SEED_TABLES;

  for (const table of tables) {
    const rows = rowsByTable[table];
    if (rows.length === 0) {
      continue;
    }
    const { error } = await client.from(table).upsert(rows);
    throwOnError(table, 'seed', error);
  }

  return fixtures;
}

/**
 * Removes only the deterministic rows created for the given prefix.
 * Pass the same prefix used with `seedDatabase` to restore a clean state.
 */
export async function cleanDatabase(
  client: SeedClient,
  idPrefix: string,
  options: SeedDatabaseOptions = {},
): Promise<void> {
  const fixtures = createSeedFixtures({ ...options, idPrefix });
  const rowsByTable = tableRows(fixtures);
  const tables = options.tables ?? SEED_TABLES;

  for (const table of tables) {
    const ids = rowsByTable[table].map((row) => row.id as string);
    if (ids.length === 0) {
      continue;
    }
    const { error } = await client.from(table).delete().in('id', ids);
    throwOnError(table, 'clean', error);
  }
}

/**
 * Restores a clean state and re-seeds the deterministic dataset in one call.
 * Returns the prefix used so tests can reference their own namespace.
 */
export async function resetDatabase(
  client: SeedClient,
  options: SeedDatabaseOptions = {},
): Promise<{ idPrefix: string; fixtures: SeedFixtures }> {
  const idPrefix = options.idPrefix ?? '';
  await cleanDatabase(client, idPrefix, options);
  const fixtures = await seedDatabase(client, options);
  return { idPrefix, fixtures };
}