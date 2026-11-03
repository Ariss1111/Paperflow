import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { fixture } from "../helpers/util";
import { makeAgreement } from "../helpers/docs";

// Accounts and cloud documents end to end through the real route handlers, on the built-in
// database (PGlite) and local blob storage. Each Client is a separate browser with its own cookies.

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "pf-cloud-"));
vi.stubEnv("DATA_DIR", DATA);
vi.stubEnv("AUTH_SECRET", "test-secret-test-secret-test-secret-123");
vi.stubEnv("RATE_LIMIT_UPLOADS_PER_MIN", "1000");
const ORIGIN = "http://localhost:3210";

type Mod = Record<string, (req: NextRequest, ctx: never) => Promise<Response>>;
const R: Record<string, Mod> = {};
const ROUTES = {
  files: "@/app/api/files/route",
  signup: "@/app/api/auth/signup/route",
  login: "@/app/api/auth/login/route",
  logout: "@/app/api/auth/logout/route",
  me: "@/app/api/auth/me/route",
  password: "@/app/api/auth/password/route",
  verify: "@/app/api/auth/verify/route",
  reset: "@/app/api/auth/reset/route",
  docs: "@/app/api/docs/route",
  doc: "@/app/api/docs/[id]/route",
  open: "@/app/api/docs/[id]/open/route",
  file: "@/app/api/docs/[id]/file/route",
  versions: "@/app/api/docs/[id]/versions/route",
  shares: "@/app/api/docs/[id]/shares/route",
  share: "@/app/api/shares/[id]/route",
  trash: "@/app/api/trash/route",
  folders: "@/app/api/folders/route",
  folder: "@/app/api/folders/[id]/route",
  storage: "@/app/api/storage/route",
  blob: "@/app/api/blob/route",
  s: "@/app/api/s/[id]/route",
  sfile: "@/app/api/s/[id]/file/route",
  mail: "@/app/api/dev/mail/route",
};

let n = 0;
class Client {
  cookies = new Map<string, string>();
  constructor(public ip = `10.0.0.${++n}`) {
    this.cookies.set("pf_sid", `sid${n}`.padEnd(43, "x"));
  }
  async call(mod: string, method: string, o: { body?: unknown; form?: FormData; query?: string; id?: string; origin?: string; headers?: Record<string, string> } = {}) {
    const url = `${ORIGIN}/x${o.query ? `?${o.query}` : ""}`;
    const headers: Record<string, string> = { host: "localhost:3210", origin: o.origin ?? ORIGIN, cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "), "x-forwarded-for": this.ip, ...o.headers };
    if (o.body !== undefined) headers["content-type"] = "application/json";
    const req = new NextRequest(url, { method, headers, body: o.form ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) });
    const res = await R[mod][method](req, { params: Promise.resolve({ id: o.id ?? "" }) } as never);
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(";");
      const [k, v] = kv.split("=");
      if (attrs.some((a) => /max-age=0\b/i.test(a.trim())) || v === "") this.cookies.delete(k.trim());
      else this.cookies.set(k.trim(), v);
    }
    const text = res.status === 303 || res.status === 307 ? "" : await res.text();
    let data: Record<string, unknown> & { error?: string } = {};
    try {
      data = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { status: res.status, data: data as any, location: res.headers.get("location"), res, text }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  async upload(name: string, bytes: Uint8Array) {
    const fd = new FormData();
    fd.append("file", new Blob([bytes as Uint8Array<ArrayBuffer>]), name);
    const r = await this.call("files", "POST", { form: fd });
    return r.data.files[0].id as string;
  }
  /** follows a signed-link redirect and returns the bytes */
  async fetchSigned(location: string) {
    const u = new URL(location, ORIGIN);
    const res = await R.blob.GET(new NextRequest(u, { headers: { host: "localhost:3210" } }), undefined as never);
    return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), headers: res.headers };
  }
}

async function inbox(to: string) {
  const r = await new Client().call("mail", "GET");
  return (r.data.messages as { to: string; subject: string; text: string }[]).filter((m) => m.to === to);
}
const linkToken = (text: string) => decodeURIComponent(/token=([^\s]+)/.exec(text)![1]);

/** Signs up, confirms the email from the dev inbox and returns the signed-in client. */
async function account(email: string, password = "correct horse battery") {
  const c = new Client();
  expect((await c.call("signup", "POST", { body: { email, password, name: email.split("@")[0] } })).status).toBe(200);
  const [mail] = await inbox(email);
  expect(mail.subject).toBe("Confirm your Pagelyt email address");
  expect((await c.call("verify", "POST", { body: { token: linkToken(mail.text) } })).status).toBe(200);
  return c;
}

let db: typeof import("@/lib/server/cloud/db");
let docs: typeof import("@/lib/server/cloud/docs");
beforeAll(async () => {
  for (const [k, m] of Object.entries(ROUTES)) R[k] = (await import(/* @vite-ignore */ m)) as Mod;
  db = await import("@/lib/server/cloud/db");
  docs = await import("@/lib/server/cloud/docs");
}, 60_000);
afterAll(async () => {
  await db.closeDb();
});

const pdfA = fixture("text-3pages.pdf");
const pdfB = fixture("text-1page.pdf");

describe("accounts", () => {
  it("sign up → confirm by email → signed in; tools still work without an account", async () => {
    const anon = new Client();
    expect((await anon.call("me", "GET")).data.user).toBeNull();
    expect(await anon.upload("a.pdf", pdfA)).toMatch(/^[\w-]{22}$/);
    expect((await anon.call("docs", "GET")).status).toBe(401);

    const c = new Client();
    const r = await c.call("signup", "POST", { body: { email: "Ana@Example.com", password: "correct horse battery", name: "Ana" } });
    expect(r.data).toEqual({ ok: true });
    expect(c.cookies.has("pf_auth")).toBe(false);
    const [mail] = await inbox("ana@example.com");
    // a used or wrong token is refused
    expect((await c.call("verify", "POST", { body: { token: "nope" } })).status).toBe(400);
    expect((await c.call("verify", "POST", { body: { token: linkToken(mail.text) } })).status).toBe(200);
    expect((await new Client().call("verify", "POST", { body: { token: linkToken(mail.text) } })).status).toBe(400);
    const me = (await c.call("me", "GET")).data;
    expect(me.user).toMatchObject({ email: "ana@example.com", name: "Ana", verified: true, hasPassword: true, google: false });
    expect(me.features).toEqual({ google: false, email: true, devMailbox: true });
  });

  it("sign-up looks the same for a taken address; its owner is told by email", async () => {
    const r = await new Client().call("signup", "POST", { body: { email: "ana@example.com", password: "another long password" } });
    expect(r.data).toEqual({ ok: true });
    const mails = await inbox("ana@example.com");
    expect(mails[0].subject).toBe("Someone tried to create a Pagelyt account with your email");
    // the original password still works
    expect((await new Client().call("login", "POST", { body: { email: "ana@example.com", password: "correct horse battery" } })).status).toBe(200);
  });

  it("rejects weak passwords and bad emails", async () => {
    expect((await new Client().call("signup", "POST", { body: { email: "x@y.co", password: "short" } })).data.error).toMatch(/at least 10/);
    expect((await new Client().call("signup", "POST", { body: { email: "not-an-email", password: "long enough password" } })).data.error).toMatch(/valid email/);
  });

  it("login, logout, wrong passwords and throttling", async () => {
    await account("bo@example.com");
    const c = new Client();
    expect((await c.call("login", "POST", { body: { email: "bo@example.com", password: "wrong password!!" } })).status).toBe(401);
    expect((await c.call("login", "POST", { body: { email: "nobody@example.com", password: "wrong password!!" } })).data.error).toBe("That email and password don't match.");
    const ok = await c.call("login", "POST", { body: { email: "BO@example.com", password: "correct horse battery" } });
    expect(ok.status).toBe(200);
    const cookie = c.cookies.get("pf_auth")!;
    expect(ok.res.headers.getSetCookie().join()).toMatch(/HttpOnly/i);
    expect(ok.res.headers.getSetCookie().join()).toMatch(/SameSite=lax/i);
    await c.call("logout", "POST", { body: {} });
    expect((await c.call("me", "GET")).data.user).toBeNull();
    // the old cookie is dead on the server, not just deleted in the browser
    c.cookies.set("pf_auth", cookie);
    expect((await c.call("me", "GET")).data.user).toBeNull();

    const attacker = new Client("66.66.66.66");
    for (let i = 0; i < 8; i++) await attacker.call("login", "POST", { body: { email: "bo@example.com", password: `guess number ${i}` } });
    expect((await attacker.call("login", "POST", { body: { email: "bo@example.com", password: "correct horse battery" } })).status).toBe(429);
  });

  it("password reset: email link, new password, every other device signed out", async () => {
    const phone = await account("cy@example.com");
    const anon = new Client();
    expect((await anon.call("reset", "POST", { body: { email: "nobody@example.com" } })).data).toEqual({ ok: true });
    await anon.call("reset", "POST", { body: { email: "cy@example.com" } });
    const [mail] = (await inbox("cy@example.com")).filter((m) => m.subject === "Reset your Pagelyt password");
    expect((await anon.call("reset", "POST", { body: { token: linkToken(mail.text), password: "brand new password 1" } })).status).toBe(200);
    expect((await anon.call("me", "GET")).data.user.email).toBe("cy@example.com");
    expect((await phone.call("me", "GET")).data.user).toBeNull();
    expect((await new Client().call("login", "POST", { body: { email: "cy@example.com", password: "correct horse battery" } })).status).toBe(401);
    expect((await new Client().call("login", "POST", { body: { email: "cy@example.com", password: "brand new password 1" } })).status).toBe(200);
  });

  it("profile name, synced preferences and password change", async () => {
    const c = await account("di@example.com");
    const laptop = new Client();
    await laptop.call("login", "POST", { body: { email: "di@example.com", password: "correct horse battery" } });
    await c.call("me", "PATCH", { body: { name: "Diana", prefs: { sort: "name" } } });
    await laptop.call("me", "PATCH", { body: { prefs: { view: "list" } } });
    expect((await c.call("me", "GET")).data.user).toMatchObject({ name: "Diana", prefs: { sort: "name", view: "list" } });
    expect((await c.call("password", "POST", { body: { current: "wrong", password: "another good password" } })).status).toBe(401);
    expect((await c.call("password", "POST", { body: { current: "correct horse battery", password: "another good password" } })).status).toBe(200);
    expect((await laptop.call("me", "GET")).data.user).toBeNull();
    expect((await c.call("me", "GET")).data.user.name).toBe("Diana");
  });

  it("email links use the configured address, never a forged Host header", async () => {
    await account("hdr@example.com");
    vi.stubEnv("APP_URL", "https://pagelyt.example");
    // a scripted request can make its headers agree with each other
    const forged = await new Client().call("reset", "POST", { body: { email: "hdr@example.com" }, origin: "https://evil.example", headers: { host: "evil.example", "x-forwarded-host": "evil.example" } });
    expect(forged.status).toBe(200);
    const [mail] = (await inbox("hdr@example.com")).filter((m) => m.subject === "Reset your Pagelyt password");
    expect(mail.text).toContain("https://pagelyt.example/reset/confirm?token=");
    expect(mail.text).not.toContain("evil.example");
    // in production, without a configured address, no link is sent at all
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_MAILBOX", "");
    try {
      const r = await new Client().call("reset", "POST", { body: { email: "hdr@example.com" }, origin: "https://evil.example", headers: { host: "evil.example" } });
      expect(r.status).toBe(503);
    } finally {
      vi.stubEnv("NODE_ENV", "test");
    }
  });

  it("rate limits can't be dodged with a forged X-Forwarded-For", async () => {
    await account("xff@example.com");
    // the proxy appends the real address last; the forged first entry changes every time
    for (let i = 0; i < 8; i++) {
      await new Client().call("login", "POST", { body: { email: `nobody${i}@example.com`, password: "wrong password!!" }, headers: { "x-forwarded-for": `1.2.3.${i}, 203.0.113.9` } });
    }
    const r = await new Client().call("login", "POST", { body: { email: "xff@example.com", password: "correct horse battery" }, headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.9" } });
    expect(r.status).toBe(429);
  });

  it("marks cookies Secure behind an HTTPS proxy", async () => {
    await account("tls@example.com");
    const r = await new Client().call("login", "POST", { body: { email: "tls@example.com", password: "correct horse battery" }, headers: { "x-forwarded-proto": "https" } });
    expect(r.res.headers.getSetCookie().join()).toMatch(/pf_auth=[^;]+;.*Secure/i);
  });

  it("blocks cross-site requests", async () => {
    const r = await new Client().call("login", "POST", { body: { email: "bo@example.com", password: "x" }, origin: "https://evil.example" });
    expect(r.status).toBe(403);
  });

  it("an unconfirmed account can't store documents", async () => {
    const c = new Client();
    await c.call("signup", "POST", { body: { email: "ed@example.com", password: "correct horse battery" } });
    await c.call("login", "POST", { body: { email: "ed@example.com", password: "correct horse battery" } });
    expect((await c.call("me", "GET")).data.user.verified).toBe(false);
    const r = await c.call("docs", "GET");
    expect(r.status).toBe(403);
    expect(r.data.error).toMatch(/Confirm your email/);
  });
});

describe("documents", () => {
  let ana: Client;
  let docId: string;
  beforeAll(async () => {
    ana = new Client();
    await ana.call("login", "POST", { body: { email: "ana@example.com", password: "correct horse battery" } });
  });

  it("saves, lists, downloads through a signed link, and refuses tampered links", async () => {
    const fid = await ana.upload("Report.pdf", pdfA);
    const r = await ana.call("docs", "POST", { body: { fileId: fid } });
    expect(r.status).toBe(201);
    docId = r.data.document.id;
    expect(r.data.document).toMatchObject({ name: "Report.pdf", format: "pdf", pages: 3, size: pdfA.length, version: 1 });
    const list = await ana.call("docs", "GET");
    expect(list.data.documents.map((d: { name: string }) => d.name)).toEqual(["Report.pdf"]);

    const dl = await ana.call("file", "GET", { id: docId });
    expect(dl.status).toBe(303);
    expect(dl.location).toMatch(/\/api\/blob\?k=d%2F/);
    const got = await ana.fetchSigned(dl.location!);
    expect(got.status).toBe(200);
    expect(Buffer.from(got.bytes).equals(Buffer.from(pdfA))).toBe(true);
    expect(got.headers.get("content-disposition")).toMatch(/^attachment; filename="Report.pdf"/);
    expect(got.headers.get("content-security-policy")).toMatch(/sandbox/);
    // change anything in the link and it stops working
    const u = new URL(dl.location!, ORIGIN);
    u.searchParams.set("n", "Other.pdf");
    expect((await ana.fetchSigned(u.toString())).status).toBe(403);
    const exp = new URL(dl.location!, ORIGIN);
    exp.searchParams.set("e", "1000");
    expect((await ana.fetchSigned(exp.toString())).status).toBe(403);
    // the file isn't reachable any other way: stored under a random name outside the web root
    const stored = fs.readdirSync(path.join(DATA, "blobs"), { recursive: true }) as string[];
    expect(stored.some((f) => f.includes("Report"))).toBe(false);
  });

  it("rename, favorite, folders, move, search and sort", async () => {
    const fid = await ana.upload("small.pdf", pdfB);
    const small = (await ana.call("docs", "POST", { body: { fileId: fid } })).data.document;
    expect((await ana.call("doc", "PATCH", { id: docId, body: { name: "Quarterly report" } })).data.document.name).toBe("Quarterly report.pdf");
    expect((await ana.call("doc", "PATCH", { id: small.id, body: { favorite: true } })).data.document.favorite).toBe(true);
    const folder = (await ana.call("folders", "POST", { body: { name: "Invoices" } })).data.folder;
    const sub = (await ana.call("folders", "POST", { body: { name: "2026", parentId: folder.id } })).data.folder;
    await ana.call("doc", "PATCH", { id: small.id, body: { folderId: sub.id } });

    const top = (await ana.call("docs", "GET")).data;
    expect(top.documents.map((d: { name: string }) => d.name)).toEqual(["Quarterly report.pdf"]);
    expect(top.folders.map((f: { name: string }) => f.name)).toEqual(["2026", "Invoices"]);
    expect((await ana.call("docs", "GET", { query: `folder=${sub.id}` })).data.documents.map((d: { id: string }) => d.id)).toEqual([small.id]);
    expect((await ana.call("docs", "GET", { query: "view=favorites" })).data.documents.map((d: { id: string }) => d.id)).toEqual([small.id]);
    // search covers every folder
    expect((await ana.call("docs", "GET", { query: "q=SMALL" })).data.documents.map((d: { id: string }) => d.id)).toEqual([small.id]);
    expect((await ana.call("docs", "GET", { query: "q=%25" })).data.documents).toEqual([]);
    const bySize = (await ana.call("docs", "GET", { query: "q=.pdf&sort=size&dir=asc" })).data.documents.map((d: { size: number }) => d.size);
    expect(bySize).toEqual([...bySize].sort((a, b) => a - b));
    const byName = (await ana.call("docs", "GET", { query: "q=.pdf&sort=name&dir=asc" })).data.documents.map((d: { name: string }) => d.name);
    expect(byName).toEqual(["Quarterly report.pdf", "small.pdf"]);

    // a folder can't go inside its own subfolder; deleting one moves its contents up
    expect((await ana.call("folder", "PATCH", { id: folder.id, body: { parentId: sub.id } })).data.error).toMatch(/into itself/);
    await ana.call("folder", "DELETE", { id: sub.id });
    expect((await ana.call("docs", "GET", { query: `folder=${folder.id}` })).data.documents.map((d: { id: string }) => d.id)).toEqual([small.id]);
  });

  it("versions: open in the editor, save a new version, see history, restore", async () => {
    const opened = (await ana.call("open", "POST", { id: docId, body: {} })).data.file;
    expect(opened).toMatchObject({ name: "Quarterly report.pdf", pages: 3 });
    const edited = await ana.upload("edited.pdf", fixture("text-3pages-changed.pdf"));
    const v2 = (await ana.call("versions", "POST", { id: docId, body: { fileId: edited } })).data.document;
    expect(v2.version).toBe(2);
    const detail = (await ana.call("doc", "GET", { id: docId })).data;
    expect(detail.versions.map((v: { version: number; note: string }) => [v.version, v.note])).toEqual([[2, "Edited"], [1, "Uploaded"]]);
    expect(detail.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(["uploaded", "renamed", "version"]));
    // the old version is still downloadable
    const old = await ana.fetchSigned((await ana.call("file", "GET", { id: docId, query: "version=1" })).location!);
    expect(Buffer.from(old.bytes).equals(Buffer.from(pdfA))).toBe(true);
    // a different kind of file can't become a version
    const img = await ana.upload("photo.png", fixture("photo.png"));
    expect((await ana.call("versions", "POST", { id: docId, body: { fileId: img } })).data.error).toMatch(/same kind of file/);
    const v3 = (await ana.call("versions", "POST", { id: docId, body: { restore: 1 } })).data.document;
    expect(v3).toMatchObject({ version: 3, size: pdfA.length });
  });

  it("storage overview and quota", async () => {
    const s = (await ana.call("storage", "GET")).data;
    expect(s.documents).toBe(2);
    expect(s.versions).toBe(4);
    expect(s.used).toBe(pdfA.length * 2 + fixture("text-3pages-changed.pdf").length + pdfB.length);
    expect(s.available).toBe(s.quota - s.used);
    expect(s.largest[0].name).toBe("Quarterly report.pdf");
    expect(s.recent).toHaveLength(2);
    vi.stubEnv("STORAGE_QUOTA_MB", "0.001");
    const fid = await ana.upload("one-more.pdf", pdfB);
    const r = await ana.call("docs", "POST", { body: { fileId: fid } });
    expect(r.status).toBe(413);
    expect(r.data.error).toMatch(/Not enough storage/);
    vi.stubEnv("STORAGE_QUOTA_MB", "");
  });

  it("validates file type by content and refuses oversized documents", async () => {
    const user = (await (await import("@/lib/server/cloud/auth")).currentUser(new NextRequest(ORIGIN, { headers: { cookie: `pf_auth=${ana.cookies.get("pf_auth")}` } })))!;
    const fake = path.join(DATA, "fake.pdf");
    fs.writeFileSync(fake, "MZ this is a program, not a PDF");
    await expect(docs.addDocument(user, fake, "invoice.pdf")).rejects.toThrow();
    vi.stubEnv("MAX_DOCUMENT_MB", "0.0001");
    const big = path.join(DATA, "big.pdf");
    fs.writeFileSync(big, pdfA);
    await expect(docs.addDocument(user, big, "big.pdf")).rejects.toThrow(/larger than/);
    vi.stubEnv("MAX_DOCUMENT_MB", "");
  });

  it("another device sees changes (sync revision)", async () => {
    const phone = new Client();
    await phone.call("login", "POST", { body: { email: "ana@example.com", password: "correct horse battery" } });
    const before = (await phone.call("docs", "GET", { query: "rev=1" })).data.rev;
    await ana.call("doc", "PATCH", { id: docId, body: { name: "Q1 report" } });
    const after = (await phone.call("docs", "GET", { query: "rev=1" })).data.rev;
    expect(after).not.toBe(before);
    expect((await phone.call("docs", "GET")).data.documents.map((d: { name: string }) => d.name)).toContain("Q1 report.pdf");
  });

  it("one user can never reach another user's documents, folders or links", async () => {
    const eve = await account("eve@example.com");
    const folderOfAna = (await ana.call("folders", "POST", { body: { name: "Private" } })).data.folder;
    expect((await eve.call("doc", "GET", { id: docId })).status).toBe(404);
    expect((await eve.call("doc", "PATCH", { id: docId, body: { name: "pwned" } })).status).toBe(404);
    expect((await eve.call("doc", "DELETE", { id: docId })).status).toBe(404);
    expect((await eve.call("file", "GET", { id: docId })).status).toBe(404);
    expect((await eve.call("open", "POST", { id: docId, body: {} })).status).toBe(404);
    expect((await eve.call("versions", "POST", { id: docId, body: { restore: 1 } })).status).toBe(404);
    expect((await eve.call("shares", "POST", { id: docId, body: {} })).status).toBe(404);
    expect((await eve.call("docs", "GET", { query: `folder=${folderOfAna.id}` })).status).toBe(404);
    expect((await eve.call("folder", "DELETE", { id: folderOfAna.id })).status).toBe(404);
    const mine = await eve.upload("eve.pdf", pdfB);
    expect((await eve.call("docs", "POST", { body: { fileId: mine, folderId: folderOfAna.id } })).status).toBe(404);
    // nor read Ana's working copies in her browser session
    const anaFile = await ana.upload("session.pdf", pdfB);
    expect((await eve.call("docs", "POST", { body: { fileId: anaFile } })).status).toBe(404);
    expect((await eve.call("docs", "GET")).data.documents).toEqual([]);
    expect((await ana.call("doc", "GET", { id: docId })).data.document.name).toBe("Q1 report.pdf");
  });
});

describe("sharing", () => {
  let ana: Client;
  let docId: string;
  beforeAll(async () => {
    ana = new Client();
    await ana.call("login", "POST", { body: { email: "ana@example.com", password: "correct horse battery" } });
    const fid = await ana.upload("Contract.pdf", await makeAgreement(1));
    docId = (await ana.call("docs", "POST", { body: { fileId: fid } })).data.document.id;
  });

  it("a password-protected, view-only link that expires", async () => {
    const share = (await ana.call("shares", "POST", { id: docId, body: { access: "link", password: "open sesame", allowDownload: false, expiresAt: Date.now() + 86400_000 } })).data.share;
    expect(share).toMatchObject({ access: "link", hasPassword: true, allowDownload: false, active: true });
    expect(share.id).toMatch(/^[\w-]{22}$/);

    const guest = new Client();
    const locked = (await guest.call("s", "GET", { id: share.id })).data;
    expect(locked.gate).toBe("password");
    // nothing about the document leaks before the password
    expect(locked.document).toBeUndefined();
    expect((await guest.call("sfile", "GET", { id: share.id })).status).toBe(403);
    expect((await guest.call("s", "POST", { id: share.id, body: { password: "wrong" } })).status).toBe(401);
    expect((await guest.call("s", "POST", { id: share.id, body: { password: "open sesame" } })).status).toBe(200);
    const open = (await guest.call("s", "GET", { id: share.id, query: "view=1" })).data;
    expect(open).toMatchObject({ gate: "ok", document: { name: "Contract.pdf", format: "pdf", owner: "Ana" } });
    expect(open.blobKey).toBeUndefined();
    // viewing works, downloading doesn't
    const view = await guest.call("sfile", "GET", { id: share.id });
    expect(view.status).toBe(303);
    const viewed = await guest.fetchSigned(view.location!);
    expect(viewed.headers.get("content-disposition")).toMatch(/^inline/);
    expect((await guest.call("sfile", "GET", { id: share.id, query: "download=1" })).data.error).toMatch(/turned off downloading/);
    // the unlock is tied to this browser
    expect((await new Client().call("s", "GET", { id: share.id })).data.gate).toBe("password");
    // views are counted for the owner
    expect((await ana.call("shares", "GET", { id: docId })).data.shares[0].views).toBe(1);

    // brute force is throttled
    const bot = new Client("77.77.77.77");
    for (let i = 0; i < 10; i++) await bot.call("s", "POST", { id: share.id, body: { password: `try ${i}` } });
    expect((await bot.call("s", "POST", { id: share.id, body: { password: "open sesame" } })).status).toBe(429);

    // expiry
    await (await db.db()).query("update shares set expires_at = now() - interval '1 minute' where id = $1", [share.id]);
    expect((await guest.call("s", "GET", { id: share.id })).status).toBe(404);
  });

  it("a public link with downloads, then revoked", async () => {
    const share = (await ana.call("shares", "POST", { id: docId, body: { access: "link" } })).data.share;
    const guest = new Client();
    expect((await guest.call("s", "GET", { id: share.id })).data.gate).toBe("ok");
    const dl = await guest.call("sfile", "GET", { id: share.id, query: "download=1" });
    const got = await guest.fetchSigned(dl.location!);
    expect(got.headers.get("content-disposition")).toMatch(/^attachment; filename="Contract.pdf"/);
    expect(Buffer.from(got.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await ana.call("share", "PATCH", { id: share.id, body: { revoke: true } })).data.share.active).toBe(false);
    expect((await guest.call("s", "GET", { id: share.id })).status).toBe(404);
    expect((await guest.call("sfile", "GET", { id: share.id })).status).toBe(404);
    // and nobody else can revoke or change your links
    const other = (await ana.call("shares", "POST", { id: docId, body: { access: "link" } })).data.share;
    const eve = new Client();
    await eve.call("login", "POST", { body: { email: "eve@example.com", password: "correct horse battery" } });
    expect((await eve.call("share", "PATCH", { id: other.id, body: { revoke: true } })).status).toBe(404);
  });

  it("a private link opens only for the people it names, once signed in", async () => {
    const share = (await ana.call("shares", "POST", { id: docId, body: { access: "private", emails: ["Fay@Example.com"] } })).data.share;
    expect(share.emails).toEqual(["fay@example.com"]);
    expect((await new Client().call("s", "GET", { id: share.id })).data.gate).toBe("signin");
    const eve = new Client();
    await eve.call("login", "POST", { body: { email: "eve@example.com", password: "correct horse battery" } });
    expect((await eve.call("s", "GET", { id: share.id })).data.gate).toBe("forbidden");
    expect((await eve.call("sfile", "GET", { id: share.id })).status).toBe(403);
    const fay = await account("fay@example.com");
    expect((await fay.call("s", "GET", { id: share.id })).data.gate).toBe("ok");
    expect((await ana.call("shares", "POST", { id: docId, body: { access: "private", emails: [] } })).data.error).toMatch(/at least one person/);
  });

  it("trash stops links at once; restore; delete forever removes the files", async () => {
    const share = (await ana.call("shares", "POST", { id: docId, body: { access: "link" } })).data.share;
    const key = (await (await db.db()).query<{ blob_key: string }>("select blob_key from documents where id = $1", [docId]))[0].blob_key;
    const file = path.join(DATA, "blobs", key.slice(2, 4), key.slice(2));
    expect(fs.existsSync(file)).toBe(true);
    await ana.call("doc", "DELETE", { id: docId });
    expect((await new Client().call("s", "GET", { id: share.id })).status).toBe(404);
    expect((await ana.call("docs", "GET", { query: "view=trash" })).data.documents.map((d: { id: string }) => d.id)).toContain(docId);
    expect((await ana.call("file", "GET", { id: docId })).status).toBe(404);
    await ana.call("doc", "PATCH", { id: docId, body: { restore: true } });
    expect((await ana.call("doc", "GET", { id: docId })).data.document.deletedAt).toBeNull();
    await ana.call("doc", "DELETE", { id: docId });
    expect((await ana.call("doc", "DELETE", { id: docId, query: "forever=1" })).status).toBe(200);
    expect(fs.existsSync(file)).toBe(false);
    expect((await ana.call("doc", "GET", { id: docId })).status).toBe(404);
  });
});

describe("cleanup and account deletion", () => {
  it("removes expired sessions, stale unconfirmed accounts and old trash", async () => {
    const d = await db.db();
    const ghost = new Client();
    await ghost.call("signup", "POST", { body: { email: "ghost@example.com", password: "correct horse battery" } });
    await d.query("update users set created_at = now() - interval '8 days' where email = 'ghost@example.com'");
    const gus = await account("gus@example.com");
    const fid = await gus.upload("old.pdf", pdfB);
    const doc = (await gus.call("docs", "POST", { body: { fileId: fid } })).data.document;
    await gus.call("doc", "DELETE", { id: doc.id });
    await d.query("update documents set deleted_at = now() - interval '31 days' where id = $1", [doc.id]);
    await d.query("update sessions set expires_at = now() - interval '1 second' where user_id = (select id from users where email = 'gus@example.com')");
    await docs.cleanup();
    expect(await d.query("select 1 from users where email = 'ghost@example.com'")).toEqual([]);
    expect(await d.query("select 1 from documents where id = $1", [doc.id])).toEqual([]);
    expect((await gus.call("me", "GET")).data.user).toBeNull();
  });

  it("deleting an account removes its documents, files, links and sessions", async () => {
    const hal = await account("hal@example.com");
    const fid = await hal.upload("mine.pdf", pdfA);
    const doc = (await hal.call("docs", "POST", { body: { fileId: fid } })).data.document;
    const share = (await hal.call("shares", "POST", { id: doc.id, body: { access: "link" } })).data.share;
    const d = await db.db();
    const [{ blob_key }] = await d.query<{ blob_key: string }>("select blob_key from documents where id = $1", [doc.id]);
    expect((await hal.call("me", "DELETE", { body: { password: "wrong" } })).status).toBe(401);
    expect((await hal.call("me", "DELETE", { body: { password: "correct horse battery" } })).status).toBe(200);
    expect(await d.query("select 1 from users where email = 'hal@example.com'")).toEqual([]);
    expect(fs.existsSync(path.join(DATA, "blobs", blob_key.slice(2, 4), blob_key.slice(2)))).toBe(false);
    expect((await new Client().call("s", "GET", { id: share.id })).status).toBe(404);
    expect((await hal.call("me", "GET")).data.user).toBeNull();
    expect((await new Client().call("login", "POST", { body: { email: "hal@example.com", password: "correct horse battery" } })).status).toBe(401);
  });
});
