/**
 * Verification suite for the deterministic seeding utility (BE-127).
 *
 * Proves the acceptance criteria:
 *   - the dataset is deterministic (identical across calls and runs),
 *   - each test is isolated from every other test's records,
 *   - teardown restores a clean state,
 *   - the suite is independent of execution order.
 */
import { createSeedFixtures, mulberry32 } from './seed-data.fixtures';
import {
  cleanDatabase,
  resetDatabase,
  seedDatabase,
  SEED_TABLES,
} from './seed.util';
import { createInMemorySeedStore, type InMemorySeedStore } from './in-memory-seed.store';
import { createTestIsolation } from './test-isolation.util';

describe('deterministic seeding (BE-127)', () => {
  describe('seed data fixtures', () => {
    it('produces byte-identical datasets across calls', () => {
      const first = createSeedFixtures();
      const second = createSeedFixtures();

      expect(second).toEqual(first);
    });

    it('derives non-trivial fields from the PRNG seed', () => {
      const a = createSeedFixtures({ seed: 826 });
      const b = createSeedFixtures({ seed: 826 });

      expect(b.transactions.map((t) => t.amount)).toEqual(
        a.transactions.map((t) => t.amount),
      );
      expect(b.users.map((u) => u.public_key)).toEqual(
        a.users.map((u) => u.public_key),
      );
    });

    it('supports the canonical entity set (users, usernames, links, transactions, receipts)', () => {
      const fixtures = createSeedFixtures();

      expect(fixtures.users).toHaveLength(3);
      expect(fixtures.usernames).toHaveLength(3);
      expect(fixtures.links).toHaveLength(3);
      expect(fixtures.transactions).toHaveLength(3);
      expect(fixtures.receipts).toHaveLength(3);

      // Foreign keys resolve to seeded primary keys.
      expect(fixtures.receipts[0].transaction_id).toBe(fixtures.transactions[0].id);
      expect(fixtures.links[0].user_id).toBe(fixtures.users[0].id);
    });

    it('namespaces ids when an idPrefix is supplied', () => {
      const a = createSeedFixtures({ idPrefix: 'suiteA_' });
      const b = createSeedFixtures({ idPrefix: 'suiteB_' });

      for (const id of [...a.users, ...b.users].map((u) => u.id)) {
        if (id.startsWith('suiteA_')) {
          expect(b.users.map((u) => u.id)).not.toContain(id);
        }
      }

      expect(a.users[0].id).toBe('suiteA_user_001');
      expect(b.users[0].id).toBe('suiteB_user_001');
    });

    it('is deterministic down to the PRNG sequence', () => {
      const rngA = mulberry32(42);
      const rngB = mulberry32(42);
      const sequenceA = Array.from({ length: 10 }, () => rngA());
      const sequenceB = Array.from({ length: 10 }, () => rngB());

      expect(sequenceB).toEqual(sequenceA);
    });
  });

  describe('seeding operations', () => {
    let store: InMemorySeedStore;

    beforeEach(() => {
      store = createInMemorySeedStore();
    });

    it('seeds the canonical dataset idempotently', async () => {
      const fixtures = await seedDatabase(store.client);

      expect(store.rows('users')).toHaveLength(fixtures.users.length);
      expect(store.rows('usernames')).toHaveLength(fixtures.usernames.length);
      expect(store.rows('links')).toHaveLength(fixtures.links.length);
      expect(store.rows('transactions')).toHaveLength(fixtures.transactions.length);
      expect(store.rows('receipts')).toHaveLength(fixtures.receipts.length);

      // Running again must not duplicate rows.
      await seedDatabase(store.client);
      expect(store.rows('users')).toHaveLength(fixtures.users.length);
    });

    it('cleans only rows belonging to a given prefix', async () => {
      await seedDatabase(store.client, { idPrefix: 'keep_' });
      await seedDatabase(store.client, { idPrefix: 'drop_' });

      await cleanDatabase(store.client, 'drop_');

      expect(store.rows('users')).toHaveLength(3);
      expect(store.rows('users').every((row) => String(row.id).startsWith('keep_'))).toBe(true);
    });

    it('resetDatabase restores a clean, freshly-seeded state', async () => {
      const { idPrefix } = await resetDatabase(store.client, {
        idPrefix: 'resetA_',
      });

      expect(idPrefix).toBe('resetA_');
      expect(store.rows('users')).toHaveLength(3);
      expect(store.rows('users').every((row) => String(row.id).startsWith('resetA_'))).toBe(true);
    });

    it('reset() clears every seeded table', () => {
      store.reset();
      for (const table of SEED_TABLES) {
        expect(store.rows(table)).toHaveLength(0);
      }
    });
  });

  describe('per-test isolation and teardown', () => {
    let store: InMemorySeedStore;

    beforeEach(() => {
      store = createInMemorySeedStore();
    });

    it('first test observes only its own records', async () => {
      await seedDatabase(store.client, { idPrefix: 'testAlpha_' });

      expect(store.rows('users').every((row) => String(row.id).startsWith('testAlpha_'))).toBe(true);
      expect(store.rows('links').every((row) => String(row.id).startsWith('testAlpha_'))).toBe(true);
    });

    it('second test observes only its own records', async () => {
      await seedDatabase(store.client, { idPrefix: 'testBeta_' });

      expect(store.rows('users').every((row) => String(row.id).startsWith('testBeta_'))).toBe(true);
      // Records from the first test must never be visible here.
      expect(store.rows('users').some((row) => String(row.id).startsWith('testAlpha_'))).toBe(false);
    });

    it('teardown restores a clean state for every seeded table', async () => {
      const isolation = createTestIsolation(store.client);
      const prefix = await isolation.seed();

      expect(prefix).toBeTruthy();
      for (const table of SEED_TABLES) {
        expect(store.rows(table).length).toBeGreaterThan(0);
      }

      await isolation.cleanup();

      for (const table of SEED_TABLES) {
        expect(store.rows(table)).toHaveLength(0);
      }
    });

    it('isolation helpers namespace data so tests cannot collide', async () => {
      const isolationA = createTestIsolation(store.client);
      const isolationB = createTestIsolation(store.client);

      await isolationA.seed();
      await isolationB.seed();

      expect(isolationA.getPrefix()).not.toBe(isolationB.getPrefix());

      const idsA = store.rows('users').map((row) => String(row.id));
      expect(idsA).toHaveLength(6);

      // Teardown of one isolation scope leaves the other untouched.
      await isolationA.cleanup();
      expect(store.rows('users')).toHaveLength(3);
      expect(store.rows('users').every((row) => String(row.id).startsWith(`${isolationB.getPrefix()}_`))).toBe(true);
    });
  });
});