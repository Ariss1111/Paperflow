import { describe, it, expect, beforeAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import type { Job, StoredFile } from "@/types";
import { fixture, reopen, firstLines, unzip, pageTexts } from "../helpers/util";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "pf-api-"));
vi.stubEnv("DATA_DIR", DATA);
vi.stubEnv("MAX_UPLOAD_MB", "5");
vi.stubEnv("RETENTION_MINUTES", "60");
vi.stubEnv("RATE_LIMIT_JOBS_PER_MIN", "1000");
vi.stubEnv("RATE_LIMIT_UPLOADS_PER_MIN", "1000");

type Routes = {
  files: typeof import("@/app/api/files/route");
  file: typeof import("@/app/api/files/[id]/route");
  content: typeof import("@/app/api/files/[id]/content/route");
  jobs: typeof import("@/app/api/jobs/route");
  job: typeof import("@/app/api/jobs/[id]/route");
  retry: typeof import("@/app/api/jobs/[id]/retry/route");
  download: typeof import("@/app/api/jobs/[id]/download/route");
  use: typeof import("@/app/api/jobs/[id]/use/route");
  store: typeof import("@/lib/server/store");
};
let r: Routes;

beforeAll(async () => {
  r = {
    files: await import("@/app/api/files/route"),
    file: await import("@/app/api/files/[id]/route"),
    content: await import("@/app/api/files/[id]/content/route"),
    jobs: await import("@/app/api/jobs/route"),
    job: await import("@/app/api/jobs/[id]/route"),
    retry: await import("@/app/api/jobs/[id]/retry/route"),
    download: await import("@/app/api/jobs/[id]/download/route"),
    use: await import("@/app/api/jobs/[id]/use/route"),
    store: await import("@/lib/server/store"),
  };
});

const ORIGIN = "http://localhost:3210";
const SID_A = "a".repeat(43);
const SID_B = "b".repeat(43);

function req(method: string, url: string, sid: string | null, body?: BodyInit, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { host: "localhost:3210", origin: ORIGIN, ...extra };
  if (sid) headers.cookie = `pf_sid=${sid}`;
  if (typeof body === "string") headers["content-type"] = "application/json";
  return new NextRequest(`${ORIGIN}${url}`, { method, headers, body });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function upload(sid: string, ...names: [string, Uint8Array<ArrayBuffer>?][]) {
  const fd = new FormData();
  for (const [name, data] of names) fd.append("file", new Blob([data ?? fixture(name)]), name);
  const res = await r.files.POST(req("POST", "/api/files", sid, fd), undefined as never);
  return { status: res.status, body: (await res.json()) as { files: StoredFile[]; errors: { name: string; error: string; code?: string }[] } };
}

async function startJob(sid: string, tool: string, files: string[], options: Record<string, unknown> = {}) {
  const res = await r.jobs.POST(req("POST", "/api/jobs", sid, JSON.stringify({ tool, files, options })), undefined as never);
  return { status: res.status, body: (await res.json()) as { job: Job; error?: string } };
}

async function waitFor(sid: string, id: string): Promise<Job> {
  for (let i = 0; i < 600; i++) {
    const res = await r.job.GET(req("GET", `/api/jobs/${id}`, sid), params(id));
    const { job } = (await res.json()) as { job: Job };
    if (!["queued", "processing"].includes(job.status)) return job;
    await new Promise((s) => setTimeout(s, 100));
  }
  throw new Error("job did not finish");
}

async function download(sid: string, id: string, q = "i=0") {
  const res = await r.download.GET(req("GET", `/api/jobs/${id}/download?${q}`, sid), params(id));
  return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
}

describe("uploads", () => {
  it("validates by content, not extension", async () => {
    const { body } = await upload(SID_A, ["image-named.pdf"], ["pdf-named.docx"]);
    expect(body.files.map((f) => f.format)).toEqual(["png", "pdf"]);
  });
  it("records page count and flags scans and encryption", async () => {
    const { body } = await upload(SID_A, ["text-5pages.pdf"], ["scanned.pdf"], ["encrypted.pdf"]);
    expect(body.files[0]).toMatchObject({ pages: 5, scanned: false, encrypted: false });
    expect(body.files[1]).toMatchObject({ scanned: true });
    expect(body.files[2]).toMatchObject({ encrypted: true });
  });
  it("rejects empty, unsupported, unreadable and oversized files with reasons", async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set(Buffer.from("%PDF-1.7\n"));
    const { status, body } = await upload(SID_A, ["empty.pdf"], ["program.exe"], ["garbage.pdf"], ["big.pdf", big]);
    expect(status).toBe(413);
    expect(body.files).toHaveLength(0);
    const codes = body.errors.map((e) => e.code);
    expect(codes).toEqual(["empty_file", "unsupported_format", "unreadable", "too_large"]);
    // nothing left behind in the incoming directory
    expect(fs.readdirSync(path.join(DATA, "incoming"))).toHaveLength(0);
  });
  it("requires a session and a same-origin request", async () => {
    const fd = new FormData();
    fd.append("file", new Blob([fixture("text-1page.pdf")]), "x.pdf");
    expect((await r.files.POST(req("POST", "/api/files", null, fd), undefined as never)).status).toBe(401);
    const cross = req("POST", "/api/files", SID_A, fd, { origin: "https://evil.example" });
    expect((await r.files.POST(cross, undefined as never)).status).toBe(403);
  });
  it("renames and deletes files", async () => {
    const { body } = await upload(SID_A, ["text-1page.pdf"]);
    const id = body.files[0].id;
    const res = await r.file.PATCH(req("PATCH", `/api/files/${id}`, SID_A, JSON.stringify({ name: "../../evil" })), params(id));
    expect(((await res.json()) as { file: StoredFile }).file.name).toBe("-evil.pdf");
    expect((await r.file.DELETE(req("DELETE", `/api/files/${id}`, SID_A), params(id))).status).toBe(200);
    expect((await r.file.GET(req("GET", `/api/files/${id}`, SID_A), params(id))).status).toBe(404);
  });
});

describe("jobs and downloads", () => {
  it("merges files end to end and the download is a valid PDF in order", async () => {
    const { body } = await upload(SID_A, ["text-3pages.pdf"], ["text-1page.pdf"]);
    const { status, body: jb } = await startJob(SID_A, "merge", body.files.map((f) => f.id));
    expect(status).toBe(202);
    expect(jb.job.status).toMatch(/queued|processing/);
    const job = await waitFor(SID_A, jb.job.id);
    expect(job.status).toBe("completed");
    expect(job.outputs[0]).toMatchObject({ name: "merged.pdf", mime: "application/pdf" });
    const { res, bytes } = await download(SID_A, job.id);
    expect(res.headers.get("content-disposition")).toContain("merged.pdf");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(bytes.length).toBe(job.outputs[0].size);
    expect(firstLines(bytes)).toEqual(["MEMO 1", "MEMO 2", "MEMO 3", "PAGE 1"]);
  });

  it("binds downloads and files to the session that created them", async () => {
    const { body } = await upload(SID_A, ["text-5pages.pdf"]);
    const job = await waitFor(SID_A, (await startJob(SID_A, "split", [body.files[0].id], { mode: "every" })).body.job.id);
    expect(job.outputs).toHaveLength(5);
    expect((await download(SID_B, job.id)).res.status).toBe(404);
    expect((await r.content.GET(req("GET", `/api/files/${body.files[0].id}/content`, SID_B), params(body.files[0].id))).status).toBe(404);
    // B can't use A's file ids in its own jobs either
    expect((await startJob(SID_B, "rotate", [body.files[0].id])).status).toBe(404);
    // ZIP of all results
    const zip = await download(SID_A, job.id, "all=1");
    expect(zip.res.headers.get("content-type")).toBe("application/zip");
    const entries = unzip(zip.bytes);
    expect([...entries.keys()].sort()).toEqual(["text-5pages-p1.pdf", "text-5pages-p2.pdf", "text-5pages-p3.pdf", "text-5pages-p4.pdf", "text-5pages-p5.pdf"]);
    expect(firstLines(new Uint8Array(entries.get("text-5pages-p4.pdf")!))).toEqual(["PAGE 4"]);
  });

  it("reports user errors as failed jobs and supports retry with corrected options", async () => {
    const { body } = await upload(SID_A, ["text-3pages.pdf"]);
    const bad = await waitFor(SID_A, (await startJob(SID_A, "split", [body.files[0].id], { mode: "ranges", ranges: "2-9" })).body.job.id);
    expect(bad.status).toBe("failed");
    expect(bad.error).toMatch(/out of range/);
    expect(bad.outputs).toHaveLength(0);
    expect((await download(SID_A, bad.id)).res.status).toBe(409);
    const res = await r.retry.POST(req("POST", `/api/jobs/${bad.id}/retry`, SID_A, JSON.stringify({ options: { ranges: "2-3" } })), params(bad.id));
    const retried = await waitFor(SID_A, ((await res.json()) as { job: Job }).job.id);
    expect(retried.status).toBe("completed");
  });

  it("rejects wrong passwords and never keeps passwords on the job", async () => {
    const { body } = await upload(SID_A, ["encrypted.pdf"]);
    const wrong = await waitFor(SID_A, (await startJob(SID_A, "unlock", [body.files[0].id], { password: "nope" })).body.job.id);
    expect(wrong.status).toBe("failed");
    expect(wrong.error).toMatch(/isn't correct/);
    expect(JSON.stringify(r.store.state.jobs.get(wrong.id)!.options)).not.toContain("nope");
    const ok = await waitFor(SID_A, (await startJob(SID_A, "unlock", [body.files[0].id], { password: "secret" })).body.job.id);
    expect(ok.status).toBe("completed");
    expect(reopen((await download(SID_A, ok.id)).bytes).needsPassword()).toBe(false);
  });

  it("blocks other tools on encrypted input and rejects wrong formats", async () => {
    const { body } = await upload(SID_A, ["encrypted.pdf"], ["photo.jpg"]);
    expect((await startJob(SID_A, "rotate", [body.files[0].id])).body.error).toMatch(/password-protected/);
    expect((await startJob(SID_A, "merge", [body.files[1].id, body.files[1].id])).status).toBe(415);
    expect((await startJob(SID_A, "nope", [body.files[1].id])).status).toBe(404);
  });

  it("compresses and reports honest sizes", async () => {
    const { body } = await upload(SID_A, ["text-1page.pdf"]);
    const job = await waitFor(SID_A, (await startJob(SID_A, "compress", [body.files[0].id], { level: "high" })).body.job.id);
    expect(job.status).toBe("completed");
    const s = job.summary!;
    expect(s.resultSize).toBeLessThanOrEqual(s.originalSize as number);
    if (!s.reduced) expect(job.notes!.join()).toMatch(/couldn't be made smaller/);
    expect(job.outputs[0].size).toBe(s.resultSize);
  });

  it("chains a result into another tool", async () => {
    const { body } = await upload(SID_A, ["text-3pages.pdf"]);
    const rotated = await waitFor(SID_A, (await startJob(SID_A, "rotate", [body.files[0].id], { angle: "180" })).body.job.id);
    const res = await r.use.POST(req("POST", `/api/jobs/${rotated.id}/use`, SID_A, JSON.stringify({ index: 0 })), params(rotated.id));
    const { file } = (await res.json()) as { file: StoredFile };
    expect(file).toMatchObject({ format: "pdf", pages: 3, sourceJobId: rotated.id });
    const numbered = await waitFor(SID_A, (await startJob(SID_A, "page-numbers", [file.id], { format: "{n}/{total}" })).body.job.id);
    expect(pageTexts((await download(SID_A, numbered.id)).bytes)[2]).toContain("3/3");
  });

  it("cancels a queued or running job", async () => {
    const { body } = await upload(SID_A, ["text-5pages.pdf"]);
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push((await startJob(SID_A, "ocr", [body.files[0].id], { skipText: false })).body.job.id);
    const last = ids[ids.length - 1];
    const res = await r.job.DELETE(req("DELETE", `/api/jobs/${last}`, SID_A), params(last));
    expect(((await res.json()) as { job: Job }).job.status).toMatch(/cancelled|processing/);
    expect((await waitFor(SID_A, last)).status).toBe("cancelled");
    for (const id of ids.slice(0, -1)) await r.job.DELETE(req("DELETE", `/api/jobs/${id}`, SID_A), params(id));
    for (const id of ids.slice(0, -1)) expect(["cancelled", "completed"]).toContain((await waitFor(SID_A, id)).status);
  });

  it("deletes expired files and results from disk", async () => {
    const { body } = await upload(SID_A, ["text-1page.pdf"]);
    const job = await waitFor(SID_A, (await startJob(SID_A, "rotate", [body.files[0].id])).body.job.id);
    const filePath = r.store.state.files.get(body.files[0].id)!.path;
    const jobDir = r.store.state.jobs.get(job.id)!.dir;
    expect(fs.existsSync(filePath) && fs.existsSync(jobDir)).toBe(true);
    await r.store.sweep(Date.now() + 61 * 60_000);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.existsSync(jobDir)).toBe(false);
    expect((await download(SID_A, job.id)).res.status).toBe(404);
  });
});

describe("OCR", () => {
  it("makes a scanned PDF searchable while keeping the scan", async () => {
    const { body } = await upload(SID_B, ["scanned.pdf"]);
    const job = await waitFor(SID_B, (await startJob(SID_B, "ocr", [body.files[0].id], { lang: "eng", output: "pdf" })).body.job.id);
    expect(job.status).toBe("completed");
    const { bytes } = await download(SID_B, job.id);
    const text = pageTexts(bytes)[0];
    expect(text).toMatch(/INVOICE 1/);
    expect(text).toMatch(/Scanned Invoice/);
    // the original image is still on the page
    let images = 0;
    reopen(bytes).loadPage(0).getObject().get("Resources").get("XObject").forEach(() => images++);
    expect(images).toBeGreaterThanOrEqual(1);
  });
});
