import { NextResponse, type NextRequest } from "next/server";
import { route, noStore } from "@/lib/server/http";
import { logIn, throttle, recordFailure, clearFailures, clientIp } from "@/lib/server/cloud/auth";
import { body, withSession } from "@/lib/server/cloud/api";
import { UserError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(
  async (req: NextRequest) => {
    const b = await body(req);
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    const keys = [`ip:${clientIp(req)}`, `email:${email}`];
    throttle(keys);
    try {
      const user = await logIn(email, b.password);
      clearFailures(keys);
      return withSession(req, NextResponse.json({ user }, { headers: noStore }), user);
    } catch (e) {
      if (e instanceof UserError && e.code === "bad_login") recordFailure(keys);
      throw e;
    }
  },
  { mutating: true },
);
