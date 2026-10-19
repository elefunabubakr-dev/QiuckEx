/**
 * In-memory backer for the seed client interface.
 *
 * Lets integration tests exercise the deterministic seeding utility without a
 * live database. Each store instance owns a private set of tables, so a fresh
 * store per test already guarantees isolation; the exposed helpers let tests
 * wire mocked repositories/services straight from rows they seeded.
 */
import type {
  SeedClient,
  SeedDeleteBuilder,
  SeedQueryResult,
  SeedTableClient,
} from './seed.util';

export type SeedStoreTable = Map<string, Record<string, unknown>>;

export interface InMemorySeedStore {
  client: SeedClient;
  tables: Record<string, SeedStoreTable>;
  /** Snapshot of all rows currently held for a table. */
  rows(table: string): Record<string, unknown>[];
  /** Snapshot of rows matching `column === value`, insertion-ordered. */
  rowsBy(table: string, column: string, value: unknown): Record<string, unknown>[];
  /** First row matching `column === value`, if any. */
  findOne(
    table: string,
    column: string,
    value: unknown,
  ): Record<string, unknown> | undefined;
  /** Wipes every table so a clean state is restored. */
  reset(): void;
}

function duplicateIdError(id: string): SeedQueryResult<unknown[]> {
  return {
    data: null,
    error: { message: `Duplicate primary key: ${id}` },
  };
}

/**
 * Creates a self-contained in-memory seed store. Pass `store.client` anywhere
 * a `SeedClient` is accepted (seedDatabase, resetDatabase, createTestIsolation).
 */
export function createInMemorySeedStore(): InMemorySeedStore {
  const tables: Record<string, SeedStoreTable> = {};

  const tableFor = (name: string): SeedStoreTable => {
    if (!tables[name]) {
      tables[name] = new Map();
    }
    return tables[name];
  };

  const deleteWhere = (
    table: SeedStoreTable,
    column: string,
    predicate: (value: unknown) => boolean,
  ): SeedQueryResult<unknown[]> => {
    const deleted: Record<string, unknown>[] = [];
    for (const [id, row] of table.entries()) {
      if (predicate(row[column])) {
        table.delete(id);
        deleted.push(row);
      }
    }
    return { data: deleted, error: null };
  };

  const builder = (tableName: string): SeedTableClient => {
    const upsert = async (
      rows: Record<string, unknown>[],
    ): Promise<SeedQueryResult<unknown[]>> => {
      const table = tableFor(tableName);
      for (const row of rows) {
        const id = row['id'] as string;
        if (!id) {
          return {
            data: null,
            error: { message: `Row without id cannot be upserted into ${tableName}` },
          };
        }
        table.set(id, { ...row });
      }
      return { data: rows, error: null };
    };

    const insert = async (
      rows: Record<string, unknown>[],
    ): Promise<SeedQueryResult<unknown[]>> => {
      const table = tableFor(tableName);
      for (const row of rows) {
        const id = row['id'] as string;
        if (!id) {
          return {
            data: null,
            error: { message: `Row without id cannot be inserted into ${tableName}` },
          };
        }
        if (table.has(id)) {
          return duplicateIdError(id);
        }
        table.set(id, { ...row });
      }
      return { data: rows, error: null };
    };

    const select = async (): Promise<SeedQueryResult<unknown[]>> => {
      return { data: [...tableFor(tableName).values()], error: null };
    };

    const deleteBuilder: SeedDeleteBuilder = {
      in: async (column, values) => {
        const wanted = new Set(values);
        return deleteWhere(tableFor(tableName), column, (value) =>
          wanted.has(value),
        );
      },
      eq: async (column, value) =>
        deleteWhere(tableFor(tableName), column, (v) => v === value),
    };

    return { select, insert, upsert, delete: () => deleteBuilder };
  };

  const client: SeedClient = { from: builder };

  return {
    client,
    tables,
    rows(table) {
      return [...tableFor(table).values()];
    },
    rowsBy(table, column, value) {
      return Array.from(tableFor(table).values()).filter(
        (row) => row[column] === value,
      );
    },
    findOne(table, column, value) {
      return Array.from(tableFor(table).values()).find(
        (row) => row[column] === value,
      );
    },
    reset() {
      for (const table of Object.keys(tables)) {
        tableFor(table).clear();
      }
    },
  };
}