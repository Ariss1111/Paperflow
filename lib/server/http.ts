import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { UserError } from "./errors";
import { init } from "./store";

const SESSION_COOKIE = "pf_sid";

export function sessionId(req: NextRequest): string {
  const sid = req.cookies.get(SESSION_COOKIE)?.value;
  if (!sid || !/^[A-Za-z0-9_-]{32,64}$/.test(sid)) {
    throw new UserError("Your session has expired. Reload the page.", "no_session", 401);
  }
  return sid;
}

/**
 * CSRF defence for state-changing requests: the session cookie is SameSite=Strict, and we also
 * require the Origin (or Sec-Fetch-Site) to match this host.
 */
export function assertSameOrigin(req: NextRequest) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new UserError("Cross-site request blocked.", "csrf", 403);
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    try {
      if (new URL(origin).host !== host) throw new Error();
    } catch {
      throw new UserError("Cross-site request blocked.", "csrf", 403);
    }
  }
}

// ------------------------------------------------------------------ rate limiting (per session, sliding window)

const g = globalThis as unknown as { __pfRate?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.__pfRate ??= new Map<string, number[]>());

export function rateLimit(key: string, perMinute: number) {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (arr.length >= perMinute) {
    throw new UserError("You're going a little fast. Wait a moment and try again.", "rate_limited", 429);
  }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 50_000) hits.clear();
}

// ------------------------------------------------------------------ handler wrapper

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

export function route<C>(fn: Handler<C>, opts: { mutating?: boolean } = {}): Handler<C> {
  return async (req, ctx) => {
    try {
      init();
      if (opts.mutating) assertSameOrigin(req);
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof UserError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
      console.error(`[api] ${req.method} ${req.nextUrl.pathname}: ${(e as Error)?.name}: ${String((e as Error)?.message).slice(0, 200)}`);
      return NextResponse.json({ error: "Something went wrong on our side. Please try again.", code: "internal" }, { status: 500 });
    }
  };
}

export function contentDisposition(name: string, inline = false): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export const noStore = { "Cache-Control": "no-store, private" };
