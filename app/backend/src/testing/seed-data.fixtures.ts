/**
 * Deterministic seed fixtures for the backend integration test suite.
 *
 * Every record is stable across runs: identifiers, public keys, amounts,
 * timestamps and statuses are derived from a fixed seed instead of the wall
 * clock or random sources. The canonical dataset covers the entities named in
 * BE-127 (users, usernames, payment links, transactions and receipts) and can
 * be namespaced with an `idPrefix` so parallel tests never collide with one
 * another.
 */

export interface SeedUser {
  id: string;
  username: string;
  email: string;
  public_key: string;
  created_at: string;
}

export interface SeedUsername {
  id: string;
  username: string;
  user_id: string;
  public_key: string;
  is_public: boolean;
  featured_rank: number | null;
  transaction_volume: number;
  transaction_count: number;
  last_active_at: string;
  created_at: string;
}

export interface SeedLink {
  id: string;
  user_id: string;
  username: string;
  amount: string;
  asset_code: string;
  memo: string;
  status: 'active' | 'paid' | 'expired';
  canonical: string;
  created_at: string;
  expires_at: string;
}

export interface SeedTransaction {
  id: string;
  user_id: string;
  username: string;
  amount: number;
  asset_code: string;
  memo: string;
  status: 'completed' | 'pending' | 'failed';
  transaction_hash: string;
  paging_token: string;
  created_at: string;
}

export interface SeedReceipt {
  id: string;
  transaction_id: string;
  user_id: string;
  username: string;
  url: string;
  created_at: string;
}

export interface SeedFixtures {
  users: SeedUser[];
  usernames: SeedUsername[];
  links: SeedLink[];
  transactions: SeedTransaction[];
  receipts: SeedReceipt[];
}

export interface CreateSeedFixturesOptions {
  /** Prefixed onto every generated key so per-test namespaces never collide. */
  idPrefix?: string;
  /** Number of canonical records to generate per entity. Defaults to 3. */
  count?: number;
  /** PRNG seed used to derive non-trivial fields deterministically. */
  seed?: number;
}

const DEFAULT_USERNAMES = ['alice', 'bob', 'carol', 'dave', 'erin'];
const BASE_TIMESTAMP_MS = Date.parse('2025-01-01T00:00:00.000Z');
const DAY_MS = 86_400_000;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_COUNT = 3;

/**
 * Small deterministic PRNG (mulberry32). Same seed in, same sequence out, on
 * every platform and every run.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic pseudo-Stellar public key (56 chars, base32 alphabet). */
function stellarPublicKey(seed: number, index: number): string {
  const rand = mulberry32(seed ^ Math.imul(index + 1, 0x9e3779b9));
  let out = 'G';
  for (let i = 0; i < 55; i += 1) {
    out += BASE32_ALPHABET[Math.floor(rand() * BASE32_ALPHABET.length)];
  }
  return out;
}

function timestamp(index: number): string {
  return new Date(BASE_TIMESTAMP_MS + index * DAY_MS).toISOString();
}

function padded(index: number, width = 3): string {
  return String(index + 1).padStart(width, '0');
}

/**
 * Builds the canonical deterministic dataset.
 *
 * Provide `idPrefix` to namespace every primary/foreign key, which is how
 * per-test isolation is achieved when several tests share one store or client.
 */
export function createSeedFixtures(
  options: CreateSeedFixturesOptions = {},
): SeedFixtures {
  const idPrefix = options.idPrefix ?? '';
  const count = Math.max(1, options.count ?? DEFAULT_COUNT);
  const rand = mulberry32(options.seed ?? 826);
  const p = (value: string | number) => `${idPrefix}${value}`;

  const users: SeedUser[] = [];
  const usernames: SeedUsername[] = [];
  const links: SeedLink[] = [];
  const transactions: SeedTransaction[] = [];
  const receipts: SeedReceipt[] = [];

  for (let i = 0; i < count; i += 1) {
    const username =
      DEFAULT_USERNAMES[i % DEFAULT_USERNAMES.length] ?? `user_${i + 1}`;
    const publicKey = stellarPublicKey(826, i);
    const userId = p(`user_${padded(i)}`);

    users.push({
      id: userId,
      username,
      email: `${username}@example.com`,
      public_key: publicKey,
      created_at: timestamp(i),
    });

    usernames.push({
      id: p(`username_${padded(i)}`),
      username,
      user_id: userId,
      public_key: publicKey,
      is_public: i % 2 === 0,
      featured_rank: i < 3 ? i + 1 : null,
      transaction_volume: (i + 1) * 500,
      transaction_count: i + 1,
      last_active_at: timestamp(i + 1),
      created_at: timestamp(i),
    });

    const linkAmount = (i + 1) * 50;
    const assetCode = i % 2 === 0 ? 'XLM' : 'USDC';
    const memo = `${username} payment ${i + 1}`;
    const status: SeedLink['status'] =
      (['active', 'paid', 'expired'] as const)[i % 3];

    links.push({
      id: p(`link_${padded(i)}`),
      user_id: userId,
      username,
      amount: linkAmount.toFixed(7),
      asset_code: assetCode,
      memo,
      status,
      canonical: `amount=${linkAmount}&asset=${assetCode}&memo=${memo}`,
      created_at: timestamp(i),
      expires_at: timestamp(i + 30),
    });

    const transactionId = p(`tx_${padded(i)}`);
    const txAmount = Math.round((i + 1) * 100 * (0.5 + rand() * 0.5) * 100) / 100;
    const txStatus: SeedTransaction['status'] =
      (['completed', 'pending', 'failed'] as const)[i % 3];

    transactions.push({
      id: transactionId,
      user_id: userId,
      username,
      amount: txAmount,
      asset_code: assetCode,
      memo,
      status: txStatus,
      transaction_hash: `tx_hash_${padded(i, 4)}`,
      paging_token: `paging_${padded(i, 4)}`,
      created_at: timestamp(i),
    });

    receipts.push({
      id: p(`receipt_${padded(i)}`),
      transaction_id: transactionId,
      user_id: userId,
      username,
      url: `https://receipts.quickex.test/${p(`receipt_${padded(i)}`)}.pdf`,
      created_at: timestamp(i),
    });
  }

  return { users, usernames, links, transactions, receipts };
}