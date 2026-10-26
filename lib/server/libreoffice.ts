import "server-only";
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { env } from "./env";
import { UserError, CancelledError } from "./errors";

const CANDIDATES = [
  path.join(env.projectRoot, ".tools", "libreoffice", "program", process.platform === "win32" ? "soffice.exe" : "soffice"),
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  "/usr/bin/soffice",
  "/usr/lib/libreoffice/program/soffice",
  "/opt/libreoffice/program/soffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
];

let resolved: string | null | undefined;

export function sofficePath(): string | null {
  if (resolved !== undefined) return resolved;
  const list = env.sofficePath ? [env.sofficePath, ...CANDIDATES] : CANDIDATES;
  resolved = list.find((p) => fs.existsSync(p)) ?? null;
  return resolved;
}

let versionCache: Promise<string | null> | null = null;
export function sofficeVersion(): Promise<string | null> {
  const bin = sofficePath();
  if (!bin) return Promise.resolve(null);
  // soffice --version opens a console window on Windows and is slow; read the bundled version file instead
  versionCache ??= (async () => {
    try {
      const ini = path.join(path.dirname(bin), process.platform === "win32" ? "version.ini" : "versionrc");
      const text = await fsp.readFile(ini, "utf8");
      return /MsiProductVersion=([\d.]+)/.exec(text)?.[1] ?? /ProductVersion=([\d.]+)/.exec(text)?.[1] ?? "installed";
    } catch {
      return "installed";
    }
  })();
  return versionCache;
}

// One conversion at a time against one warm profile: LibreOffice profiles are not safe for
// concurrent use, and a warm profile turns a ~15 s cold start into ~1–2 s.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

function killTree(pid: number | undefined) {
  if (!pid) return;
  if (process.platform === "win32") execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => undefined);
  else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

export interface ConvertOptions {
  /** e.g. "pdf", "pdf:writer_web_pdf_Export", "docx:MS Word 2007 XML" */
  convertTo: string;
  infilter?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Converts `input` with LibreOffice headless and returns the output path in `outDir`.
 * The input must carry the correct extension; LibreOffice uses it for filter detection.
 */
export function convertWithLibreOffice(input: string, outDir: string, o: ConvertOptions): Promise<string> {
  const bin = sofficePath();
  if (!bin) {
    throw new UserError(
      "LibreOffice isn't installed on this server, so Office conversions are unavailable. See README → LibreOffice.",
      "engine_unavailable",
      503,
    );
  }
  return serial(async () => {
    if (o.signal?.aborted) throw new CancelledError();
    await fsp.mkdir(outDir, { recursive: true });
    const profile = path.join(env.dataDir, "lo-profile");
    await fsp.mkdir(profile, { recursive: true });
    const args = [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      "--headless",
      "--invisible",
      "--nologo",
      "--nodefault",
      "--nofirststartwizard",
      "--nolockcheck",
      "--norestore",
      ...(o.infilter ? [`--infilter=${o.infilter}`] : []),
      "--convert-to",
      o.convertTo,
      "--outdir",
      outDir,
      input,
    ];
    const timeout = o.timeoutMs ?? env.conversionTimeoutMs;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
        env: { ...process.env, SAL_USE_VCLPLUGIN: "svp", HOME: profile },
      });
      let stderr = "";
      child.stderr.on("data", (d) => {
        if (stderr.length < 4000) stderr += String(d);
      });
      child.stdout.resume();
      const timer = setTimeout(() => {
        killTree(child.pid);
        reject(new UserError(`The conversion took longer than ${Math.round(timeout / 1000)} s and was stopped.`, "timeout", 504));
      }, timeout);
      const onAbort = () => {
        killTree(child.pid);
        reject(new CancelledError());
      };
      o.signal?.addEventListener("abort", onAbort, { once: true });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        o.signal?.removeEventListener("abort", onAbort);
        if (code === 0) resolve();
        else reject(new UserError("LibreOffice couldn't convert this file. It may be damaged or use unsupported features.", "conversion_failed", 422));
      });
    });
    const base = path.basename(input, path.extname(input));
    const ext = o.convertTo.split(":")[0];
    const out = path.join(outDir, `${base}.${ext}`);
    const st = await fsp.stat(out).catch(() => null);
    // LibreOffice exits 0 even when it silently produced nothing (e.g. unrecognised or corrupted input)
    if (!st || st.size === 0) {
      throw new UserError("LibreOffice couldn't read this file. It may be damaged, empty or password-protected.", "conversion_failed", 422);
    }
    return out;
  });
}
