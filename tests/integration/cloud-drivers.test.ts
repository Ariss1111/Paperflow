import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

// The production drivers: the real `pg` client talking the Postgres wire protocol (served here by
// PGlite's socket server), and the S3 client against a stand-in S3 server that records requests.

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "pf-drivers-"));
vi.stubEnv("DATA_DIR", DATA);
vi.stubEnv("AUTH_SECRET", "driver-test-secret-driver-test-secret");

describe("Postgres (pg driver)", () => {
  let server: { stop: () => Promise<void> };
  let pglite: { close: () => Promise<void> };
  let db: typeof import("@/lib/server/cloud/db");

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
    const p = await PGlite.create();
    pglite = p;
    const port = 45000 + Math.floor(Math.random() * 1000);
    const s = new PGLiteSocketServer({ db: p, port, host: "127.0.0.1" });
    await s.start();
    server = s;
    vi.stubEnv("DATABASE_URL", `postgres://postgres@127.0.0.1:${port}/postgres`);
    vi.stubEnv("DATABASE_POOL", "1");
    db = await import("@/lib/server/cloud/db");
  }, 60_000);
  afterAll(async () => {
    await db.closeDb();
    await server.stop();
    await pglite.close();
    vi.stubEnv("DATABASE_URL", "");
  });

  it("migrates, runs queries and transactions, and rolls back on error", async () => {
    const d = await db.db();
    const [v] = await d.query<{ v: number }>("select max(version) as v from schema_version");
    expect(v.v).toBe(1);
    await d.query("insert into users (id, email) values ($1, $2)", ["u1", "pg@example.com"]);
    await expect(
      d.tx(async (q) => {
        await q.query("insert into users (id, email) values ($1, $2)", ["u2", "rolled@example.com"]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await d.query<{ email: string }>("select email from users order by email")).map((r) => r.email)).toEqual(["pg@example.com"]);
    // bigint sums come back as numbers
    await d.query("insert into documents (id, user_id, name, format, mime, size, blob_key) values ('d1', 'u1', 'a.pdf', 'pdf', 'application/pdf', 5000000000, 'd/x')");
    const [s] = await d.query<{ s: number }>("select sum(size) as s from documents");
    expect(s.s).toBe(5_000_000_000);
  });
});

describe("S3-compatible storage", () => {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const seen: { method: string; url: string; auth: string }[] = [];
  const s3 = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization ?? "") });
      const u = new URL(req.url!, "http://s3");
      const key = decodeURIComponent(u.pathname.replace(/^\/pagelyt-docs\//, ""));
      if (req.method === "PUT") {
        objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers["content-type"]) });
        res.writeHead(200, { etag: '"x"' }).end();
      } else if (req.method === "GET") {
        const o = objects.get(key);
        if (!o) return res.writeHead(404).end();
        res.writeHead(200, { "content-type": u.searchParams.get("response-content-type") ?? o.type, "content-disposition": u.searchParams.get("response-content-disposition") ?? "", "content-length": o.body.length }).end(o.body);
      } else if (req.method === "DELETE") {
        objects.delete(key);
        res.writeHead(204).end();
      } else res.writeHead(400).end();
    });
  });
  let blobs: typeof import("@/lib/server/cloud/blobs");

  beforeAll(async () => {
    await new Promise<void>((r) => s3.listen(0, "127.0.0.1", r));
    vi.stubEnv("S3_BUCKET", "pagelyt-docs");
    vi.stubEnv("S3_ENDPOINT", `http://127.0.0.1:${(s3.address() as { port: number }).port}`);
    vi.stubEnv("S3_ACCESS_KEY_ID", "AKIATEST");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("S3_FORCE_PATH_STYLE", "1");
    blobs = await import("@/lib/server/cloud/blobs");
  });
  afterAll(() => {
    s3.close();
    for (const k of ["S3_BUCKET", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_FORCE_PATH_STYLE"]) vi.stubEnv(k, "");
  });

  it("stores, reads and deletes objects with signed requests, and issues expiring signed links", async () => {
    const store = blobs.blobs();
    expect(store.kind).toBe("s3");
    const key = blobs.newBlobKey();
    const file = path.join(DATA, "in.pdf");
    fs.writeFileSync(file, "%PDF-1.7 test");
    await store.put(key, file, "application/pdf");
    expect(objects.get(key)?.body.toString()).toBe("%PDF-1.7 test");
    expect(seen.at(-1)!.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATEST\//);
    expect(Buffer.from(await store.read(key)).toString()).toBe("%PDF-1.7 test");

    const url = await store.signedUrl(key, { filename: "Raport ă.pdf", mime: "application/pdf", seconds: 120 });
    const u = new URL(url);
    expect(u.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(u.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    // the link carries the download name; the bucket itself stays private
    const res = await fetch(url);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="Raport _.pdf"; filename\*=UTF-8''Raport%20%C4%83.pdf/);
    expect(await res.text()).toBe("%PDF-1.7 test");

    await store.remove(key);
    expect(objects.has(key)).toBe(false);
  });
});
