import { NextResponse, type NextRequest } from "next/server";
import { cloud, googleConfigured } from "@/lib/server/cloud/config";
import { googleUser } from "@/lib/server/cloud/auth";
import { baseUrl, safeNext, withSession } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (req: NextRequest, why: string) => NextResponse.redirect(new URL(`/signin?error=${encodeURIComponent(why)}`, req.url));

/** Google sends the visitor back here: check state, swap the code (with the PKCE verifier) and sign in. */
export async function GET(req: NextRequest) {
  if (!googleConfigured()) return fail(req, "Google sign-in isn't set up on this server.");
  let saved: { state: string; verifier: string; next: string };
  try {
    saved = JSON.parse(req.cookies.get("pf_google")?.value ?? "");
  } catch {
    return fail(req, "Google sign-in timed out. Please try again.");
  }
  const p = req.nextUrl.searchParams;
  if (p.get("error")) return fail(req, "Google sign-in was cancelled.");
  if (!saved?.state || p.get("state") !== saved.state || !p.get("code")) return fail(req, "Google sign-in couldn't be verified. Please try again.");
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: p.get("code")!, client_id: cloud.google.clientId, client_secret: cloud.google.clientSecret, redirect_uri: `${baseUrl(req)}/api/auth/google/callback`, grant_type: "authorization_code", code_verifier: saved.verifier }),
    });
    const tok = (await tokenRes.json()) as { access_token?: string };
    if (!tokenRes.ok || !tok.access_token) return fail(req, "Google didn't accept the sign-in. Please try again.");
    const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${tok.access_token}` } });
    const info = (await infoRes.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string };
    if (!infoRes.ok || !info.sub || !info.email) return fail(req, "Google didn't share an email address.");
    if (!info.email_verified) return fail(req, "Your Google email address isn't verified.");
    const user = await googleUser(info.sub, info.email, info.name ?? "");
    const res = NextResponse.redirect(new URL(safeNext(saved.next), req.url));
    res.cookies.set("pf_google", "", { path: "/api/auth/google", maxAge: 0 });
    return withSession(req, res, user);
  } catch (e) {
    console.error(`[google] ${(e as Error).message.slice(0, 200)}`);
    return fail(req, "Couldn't reach Google. Please try again.");
  }
}
