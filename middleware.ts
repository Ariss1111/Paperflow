import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "pf_sid";

// Every visitor gets an anonymous, random session id. Files and jobs are bound to it;
// no account is needed and nothing identifies the person.
export function middleware(req: NextRequest) {
  const sid = req.cookies.get(SESSION_COOKIE)?.value;
  if (sid && /^[A-Za-z0-9_-]{32,64}$/.test(sid)) return NextResponse.next();

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  // forward the new cookie so the route handler serving this very request sees it
  const headers = new Headers(req.headers);
  const existing = headers.get("cookie");
  headers.set("cookie", `${existing ? `${existing}; ` : ""}${SESSION_COOKIE}=${value}`);
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}

// API routes are excluded: middleware makes Next buffer request bodies (capped at 10 MB), which would
// break streamed uploads. The cookie is issued on the first page load; APIs require it (401 otherwise).
export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|pdf.worker.min.mjs|pdfjs/|fonts/|__qa/).*)"],
};
