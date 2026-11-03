import type { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import postgres from "postgres";

// The database this app owns. It holds the catalog, Matchback's own order records, the claim rows that
// guard every PayPal write (paypal_writes), refunds, price-match claims and the Channel3 cache.
//
// Two backends behind one small async interface, with the same SQL ("?" placeholders):
//   - Postgres when DATABASE_URL is set (the hosted app: Supabase, through its transaction pooler);
//   - SQLite otherwise (local development: data/matchback.db; tests: in memory).

export type Param = string | number | bigint | null | Uint8Array;

export interface Db {
  readonly dialect: "sqlite" | "postgres";
  /** First row, or undefined. */
  get(sql: string, ...params: Param[]): Promise<unknown>;
  all(sql: string, ...params: Param[]): Promise<unknown[]>;
  run(sql: string, ...params: Param[]): Promise<{ changes: number }>;
}

class SqliteDb implements Db {
  readonly dialect = "sqlite" as const;
  constructor(private readonly d: DatabaseSync) {
    migrateSqlite(d);
  }
  async get(sql: string, ...params: Param[]) {
    return this.d.prepare(sql).get(...params);
  }
  async all(sql: string, ...params: Param[]) {
    return this.d.prepare(sql).all(...params);
  }
  async run(sql: string, ...params: Param[]) {
    return { changes: Number(this.d.prepare(sql).run(...params).changes) };
  }
}

class PostgresDb implements Db {
  readonly dialect = "postgres" as const;
  private ready: Promise<void> | undefined;
  constructor(private readonly sql: postgres.Sql) {}
  private migrated() {
    // Retried on the next query if it failed (a serverless instance outlives one failed cold start).
    this.ready ??= migratePostgres(this.sql).catch((err) => {
      this.ready = undefined;
      throw err;
    });
    return this.ready;
  }
  // One query at a time. With more queries than connections the driver pipelines them on one
  // connection, and Supabase's transaction pooler never answers pipelined queries (measured
  // 2026-10-29: 12 pipelined SELECT 1 hung; the same 12 through this queue took 2 s from Paris).
  private tail: Promise<unknown> = Promise.resolve();
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }
  private async query(text: string, params: Param[]) {
    await this.migrated();
    // The driver sends a Buffer as bytea; a plain Uint8Array is converted first.
    const values = params.map((p) => (p instanceof Uint8Array && !Buffer.isBuffer(p) ? Buffer.from(p) : p));
    return this.serial(() => this.sql.unsafe(toPostgresPlaceholders(text), values as never[]));
  }
  async get(text: string, ...params: Param[]) {
    return (await this.query(text, params))[0];
  }
  async all(text: string, ...params: Param[]) {
    return [...(await this.query(text, params))];
  }
  async run(text: string, ...params: Param[]) {
    return { changes: (await this.query(text, params)).count };
  }
}

/** "?" placeholders to "$1, $2, ..." (outside quoted literals). */
export function toPostgresPlaceholders(text: string): string {
  let n = 0;
  let quoted = false;
  let out = "";
  for (const ch of text) {
    if (ch === "'") quoted = !quoted;
    out += ch === "?" && !quoted ? `$${++n}` : ch;
  }
  return out;
}

// Kept on globalThis so a dev-server reload does not open a second pool.
const holder = globalThis as unknown as { __matchbackDb?: Db };

export function getDb(): Db {
  if (holder.__matchbackDb) return holder.__matchbackDb;
  const url = process.env.DATABASE_URL;
  if (url) {
    if (!/^postgres(ql)?:\/\//.test(url)) {
      throw new Error("DATABASE_URL must be a postgresql:// connection string (Supabase: Connect → Transaction pooler), not the project's https:// API URL.");
    }
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    holder.__matchbackDb = new PostgresDb(postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10, ssl: local ? false : "require", onnotice: () => {} }));
  } else {
    const file = process.env.MATCHBACK_DB ?? "data/matchback.db";
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    holder.__matchbackDb = new SqliteDb(openSqlite(file));
  }
  return holder.__matchbackDb;
}

/** node:sqlite, loaded only when SQLite is used, so the hosted app never depends on it. */
function openSqlite(file: string): DatabaseSync {
  const { DatabaseSync: Sqlite } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  return new Sqlite(file);
}

/** For tests: a fresh in-memory SQLite database. */
export function resetDbForTests(): Db {
  holder.__matchbackDb = new SqliteDb(openSqlite(":memory:"));
  return holder.__matchbackDb;
}

function schema(): string {
  return `
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

    -- Price watch: cheaper offers the verifier approved after a purchase, before anyone claimed them.
    CREATE TABLE IF NOT EXISTS watch_findings (
      id            TEXT PRIMARY KEY,
      order_id      TEXT NOT NULL REFERENCES orders(id),
      domain        TEXT NOT NULL,
      offer_url     TEXT NOT NULL,
      price_cents   INTEGER NOT NULL,
      refund_cents  INTEGER NOT NULL,
      status        TEXT NOT NULL,   -- suggested | claimed | expired
      evidence_json TEXT NOT NULL,
      claim_id      TEXT,
      found_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS watch_findings_by_order ON watch_findings(order_id);

    -- The rules a store owner set on /merchant/settings. One row; none means the defaults.
    CREATE TABLE IF NOT EXISTS store_settings (
      id          TEXT PRIMARY KEY,
      json        TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    -- What was refunded without a person, per UTC day, against the store's daily limit.
    CREATE TABLE IF NOT EXISTS auto_refund_days (
      day    TEXT PRIMARY KEY,          -- YYYY-MM-DD
      cents  INTEGER NOT NULL
    );

    -- Channel3 answers, so a claim re-check, the evaluation and the filmed demo read the same data.
    CREATE TABLE IF NOT EXISTS channel3_cache (
      key         TEXT PRIMARY KEY,   -- lookup:<url> | product:<id> | stats:<id>
      json        TEXT NOT NULL,
      fetched_at  TEXT NOT NULL
    );
  `;
}

/** Columns added after the first release of the schema. */
function addedColumns(blob: "BLOB" | "BYTEA"): [table: string, definition: string][] {
  return [
    ["orders", "captured_at TEXT"],
    ["catalog", "image_alt TEXT"],
    ["claims", "source TEXT NOT NULL DEFAULT 'link'"],
    ["claims", "image_path TEXT"],
    ["claims", "image_mime TEXT"],
    ["claims", "competitor_domain TEXT"],
    ["claims", "locale TEXT NOT NULL DEFAULT 'en'"],
    ["orders", "watch_checked_at TEXT"],
    // Screenshot bytes live in the database: a serverless host has no lasting disk.
    ["claims", `image_data ${blob}`],
    // Lease for retrying a claim a crashed run left behind (one retry at a time across instances).
    ["claims", "retry_at TEXT"],
    // Hash of the sender's IP address, for the per-visitor claim limit. Never the address itself.
    ["claims", "client_hash TEXT"],
  ];
}

const TABLES = ["catalog", "orders", "paypal_writes", "refunds", "claims", "watch_findings", "channel3_cache", "store_settings", "auto_refund_days"];

function migrateSqlite(d: DatabaseSync) {
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec(schema());
  for (const [table, definition] of addedColumns("BLOB")) {
    const column = definition.split(" ")[0]!;
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

/** The Postgres schema, idempotent: run on the first query of each server instance. */
export function postgresSchemaSql(): string {
  return [
    schema(),
    ...addedColumns("BYTEA").map(([table, definition]) => `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${definition};`),
    // The app connects as the table owner, which bypasses RLS. Enabling it closes Supabase's public
    // REST API to these tables (no policies = no access with the public keys).
    ...TABLES.map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`),
  ].join("\n");
}

async function migratePostgres(sql: postgres.Sql) {
  // Concurrent cold starts would race on CREATE TABLE; a transaction-level advisory lock serialises them.
  await sql.begin(async (tx) => {
    await tx.unsafe("SELECT pg_advisory_xact_lock(727274)");
    await tx.unsafe(postgresSchemaSql()).simple();
  });
}

const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;
const SQLITE_CONSTRAINT_UNIQUE = 2067;
const PG_UNIQUE_VIOLATION = "23505";

/** True when an insert failed because the row already exists (recognised by error code, not message). */
export function isDuplicateKey(err: unknown): boolean {
  const e = err as { errcode?: unknown; code?: unknown } | null;
  return e?.errcode === SQLITE_CONSTRAINT_PRIMARYKEY || e?.errcode === SQLITE_CONSTRAINT_UNIQUE || e?.code === PG_UNIQUE_VIOLATION;
}

export const now = () => new Date().toISOString();
