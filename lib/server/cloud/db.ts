import "server-only";
import fs from "node:fs";
import { cloud } from "./config";

// One small interface over two engines that speak the same SQL: Postgres in production (pg) and
// PGlite (Postgres compiled to WebAssembly, stored in DATA_DIR) locally and in tests.

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}
export interface Db extends Queryable {
  /** runs fn in one transaction; any throw rolls everything back */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

async function postgres(url: string): Promise<Db> {
  const pg = await import("pg");
  // bigint (counts, sizes) and numeric (sums) arrive as text from pg: numbers are exact up to 2^53
  pg.default.types.setTypeParser(20, (v: string) => Number(v));
  pg.default.types.setTypeParser(1700, (v: string) => Number(v));
  const pool = new pg.default.Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL || 5) });
  return {
    async query(sql, params) {
      return (await pool.query(sql, params as unknown[])).rows;
    },
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query("begin");
        const out = await fn({ query: async (s, p) => (await c.query(s, p as unknown[])).rows });
        await c.query("commit");
        return out;
      } catch (e) {
        await c.query("rollback").catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}

async function embedded(dir: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  fs.mkdirSync(dir, { recursive: true });
  const db = await PGlite.create(dir);
  // PGlite is a single connection: transactions must not interleave with other queries
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => undefined);
    return p;
  };
  const norm = <T>(rows: unknown[]) => rows.map((r) => Object.fromEntries(Object.entries(r as object).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]))) as T[];
  return {
    query: (sql, params) => serial(async () => norm((await db.query(sql, params as unknown[])).rows)),
    tx: (fn) => serial(() => db.transaction((t) => fn({ query: async (s, p) => norm((await t.query(s, p as unknown[])).rows) }))),
    close: () => db.close(),
  };
}

const MIGRATIONS: string[] = [
  `
  create table users (
    id text primary key,
    email text not null unique,
    name text not null default '',
    password_hash text,
    email_verified_at timestamptz,
    google_sub text unique,
    prefs jsonb not null default '{}',
    created_at timestamptz not null default now()
  );
  create table sessions (
    id_hash text primary key,
    user_id text not null references users(id) on delete cascade,
    created_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    expires_at timestamptz not null,
    user_agent text not null default ''
  );
  create index sessions_user on sessions(user_id);
  create table tokens (
    hash text primary key,
    user_id text not null references users(id) on delete cascade,
    kind text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
  );
  create table folders (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    parent_id text references folders(id) on delete cascade,
    name text not null,
    created_at timestamptz not null default now()
  );
  create index folders_user on folders(user_id);
  create table documents (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    folder_id text references folders(id) on delete set null,
    name text not null,
    format text not null,
    mime text not null,
    size bigint not null,
    pages integer,
    blob_key text not null,
    version integer not null default 1,
    favorite boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    opened_at timestamptz,
    deleted_at timestamptz
  );
  create index documents_user on documents(user_id, deleted_at);
  create table versions (
    id text primary key,
    document_id text not null references documents(id) on delete cascade,
    version integer not null,
    size bigint not null,
    pages integer,
    blob_key text not null,
    note text not null default '',
    created_at timestamptz not null default now()
  );
  create index versions_doc on versions(document_id);
  create table events (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    document_id text references documents(id) on delete cascade,
    kind text not null,
    detail jsonb not null default '{}',
    at timestamptz not null default now()
  );
  create index events_doc on events(document_id, at);
  create table shares (
    id text primary key,
    document_id text not null references documents(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    access text not null,
    emails text[] not null default '{}',
    password_hash text,
    allow_download boolean not null default true,
    expires_at timestamptz,
    revoked_at timestamptz,
    views integer not null default 0,
    last_viewed_at timestamptz,
    created_at timestamptz not null default now()
  );
  create index shares_doc on shares(document_id);
  create table blob_trash (
    key text primary key,
    at timestamptz not null default now()
  );
  create table dev_mail (
    id text primary key,
    to_addr text not null,
    subject text not null,
    text_body text not null,
    created_at timestamptz not null default now()
  );
  `,
];

async function migrate(db: Db) {
  await db.query("create table if not exists schema_version (version integer primary key)");
  const [row] = await db.query<{ v: number | null }>("select max(version) as v from schema_version");
  for (let v = (row?.v ?? 0) + 1; v <= MIGRATIONS.length; v++) {
    await db.tx(async (q) => {
      // statements one by one: both engines accept that inside a transaction
      for (const stmt of MIGRATIONS[v - 1].split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await q.query(stmt);
      await q.query("insert into schema_version (version) values ($1)", [v]);
    });
  }
}

const g = globalThis as unknown as { __pfDb?: Promise<Db> };

/** The database, opened and migrated on first use. */
export function db(): Promise<Db> {
  g.__pfDb ??= (async () => {
    const d = cloud.databaseUrl ? await postgres(cloud.databaseUrl) : await embedded(cloud.localDbDir);
    await migrate(d);
    return d;
  })().catch((e) => {
    g.__pfDb = undefined;
    throw e;
  });
  return g.__pfDb;
}

/** Test hook: close and forget the open database. */
export async function closeDb() {
  const d = g.__pfDb;
  g.__pfDb = undefined;
  if (d) await (await d).close();
}
