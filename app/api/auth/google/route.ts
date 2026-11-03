import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { route, isHttps } from "@/lib/server/http";
import { UserError } from "@/lib/server/errors";
import { cloud, googleConfigured } from "@/lib/server/cloud/config";
import { baseUrl, safeNext } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GOOGLE_COOKIE = "pf_google";

/** Starts "Continue with Google": authorization code flow with PKCE and a state check. */
export const GET = route(async (req: NextRequest) => {
  if (!googleConfigured()) throw new UserError("Google sign-in isn't set up on this server.", "google_unavailable", 503);
  const state = crypto.randomBytes(24).toString("base64url");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const redirect = `${baseUrl(req)}/api/auth/google/callback`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: cloud.google.clientId, redirect_uri: redirect, response_type: "code", scope: "openid email profile", state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" }).toString();
  const res = NextResponse.redirect(url);
  res.cookies.set(GOOGLE_COOKIE, JSON.stringify({ state, verifier, next: safeNext(req.nextUrl.searchParams.get("next")) }), { httpOnly: true, sameSite: "lax", secure: isHttps(req), path: "/api/auth/google", maxAge: 600 });
  return res;
});
