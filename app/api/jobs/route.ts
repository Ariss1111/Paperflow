import { NextResponse, type NextRequest } from "next/server";
import { route, sessionId, rateLimit, noStore } from "@/lib/server/http";
import { createJob } from "@/lib/server/jobs";
import { listJobs } from "@/lib/server/store";
import { env } from "@/lib/server/env";
import { UserError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  return NextResponse.json({ jobs: listJobs(sessionId(req)) }, { headers: noStore });
});

export const POST = route(
  async (req: NextRequest) => {
    const sid = sessionId(req);
    rateLimit(`job:${sid}`, env.jobsPerMin);
    const body = (await req.json().catch(() => null)) as { tool?: unknown; files?: unknown; options?: unknown } | null;
    if (!body || typeof body.tool !== "string") throw new UserError("Choose a tool.");
    const job = createJob(sid, body.tool, body.files, body.options);
    return NextResponse.json({ job }, { status: 202, headers: noStore });
  },
  { mutating: true },
);
