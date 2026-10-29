import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// One SQLite file this app owns. It holds the catalog, Matchback's own order records, the
// claim rows that guard every PayPal write (paypal_writes), and refunds.

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (db) return db;
  const file = process.env.MATCHBACK_DB ?? "data/matchback.db";
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  migrate(db);
  return db;
}

/** For tests: a fresh in-memory database. */
export function resetDbForTests(): DatabaseSync {
  db = new DatabaseSync(":memory:");
  migrate(db);
  return db;
}

function migrate(d: DatabaseSync) {
  d.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS catalog (
      product_id   TEXT PRIMARY KEY,          -- pinned Channel3 product id
      title        TEXT NOT NULL,
      price_cents  INTEGER NOT NULL,
      currency     TEXT NOT NULL DEFAULT 'USD',
      image_url    TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id               TEXT PRIMARY KEY,      -- checkoutRef, sent to PayPal as purchase unit custom_id
      product_id       TEXT NOT NULL REFERENCES catalog(product_id),
      amount_cents     INTEGER NOT NULL,
      currency         TEXT NOT NULL,
      paypal_order_id  TEXT UNIQUE,
      capture_id       TEXT UNIQUE,
      captured_cents   INTEGER,
      status           TEXT NOT NULL,         -- new | awaiting_approval | captured | capture_unknown
      created_at       TEXT NOT NULL
    );

    -- The claim row for every PayPal write, inserted BEFORE the SDK call (paypal-plan.md 1b.1).
    CREATE TABLE IF NOT EXISTS paypal_writes (
      claim_key    TEXT PRIMARY KEY,          -- also sent as PayPal-Request-Id
      op           TEXT NOT NULL,
      state        TEXT NOT NULL,             -- claimed | done | unknown
      result_json  TEXT,
      created_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refunds (
      claim_id     TEXT PRIMARY KEY,          -- the price-match claim; sent as refund custom_id
      order_id     TEXT NOT NULL REFERENCES orders(id),
      capture_id   TEXT NOT NULL,
      kind         TEXT NOT NULL,             -- price_match
      amount_cents INTEGER NOT NULL,
      currency     TEXT NOT NULL,
      refund_id    TEXT,
      status       TEXT NOT NULL,             -- claimed | completed | pending | unknown
      created_at   TEXT NOT NULL
    );
    -- One price-match refund per order capture.
    CREATE UNIQUE INDEX IF NOT EXISTS refunds_one_price_match_per_capture
      ON refunds(capture_id) WHERE kind = 'price_match';

    -- A shopper's price-match claim and the verifier's decision.
    CREATE TABLE IF NOT EXISTS claims (
      id              TEXT PRIMARY KEY,
      order_id        TEXT NOT NULL REFERENCES orders(id),
      competitor_url  TEXT NOT NULL,
      status          TEXT NOT NULL,   -- verifying | approved | refused | needs_review | refunded | refund_unknown | refund_failed
      decision_json   TEXT,            -- checks, identity verdict, competitor offer, amounts
      refund_id       TEXT,
      error           TEXT,
      created_at      TEXT NOT NULL,
      decided_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS claims_by_order ON claims(order_id);

    -- Channel3 answers, so a claim re-check, the evaluation and the filmed demo read the same data.
    CREATE TABLE IF NOT EXISTS channel3_cache (
      key         TEXT PRIMARY KEY,   -- lookup:<url> | product:<id> | stats:<id>
      json        TEXT NOT NULL,
      fetched_at  TEXT NOT NULL
    );
  `);
  // Columns added after the first release of the schema.
  addColumn(d, "orders", "captured_at TEXT");
  addColumn(d, "catalog", "image_alt TEXT");
  addColumn(d, "claims", "source TEXT NOT NULL DEFAULT 'link'");
  addColumn(d, "claims", "image_path TEXT");
  addColumn(d, "claims", "image_mime TEXT");
  addColumn(d, "claims", "competitor_domain TEXT");
}

function addColumn(d: DatabaseSync, table: string, definition: string) {
  const column = definition.split(" ")[0]!;
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;
const SQLITE_CONSTRAINT_UNIQUE = 2067;

/** True when an insert failed because the row already exists (recognised by errcode, not message). */
export function isDuplicateKey(err: unknown): boolean {
  const code = (err as { errcode?: unknown } | null)?.errcode;
  return code === SQLITE_CONSTRAINT_PRIMARYKEY || code === SQLITE_CONSTRAINT_UNIQUE;
}

export const now = () => new Date().toISOString();
