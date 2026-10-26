import { NextResponse, type NextRequest } from "next/server";
import { route, sessionId, rateLimit, noStore } from "@/lib/server/http";
import { retryJob } from "@/lib/server/jobs";
import { env } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(
  async (req: NextRequest, { params }) => {
    const { id } = await params;
    const sid = sessionId(req);
    rateLimit(`job:${sid}`, env.jobsPerMin);
    const body = (await req.json().catch(() => ({}))) as { options?: Record<string, unknown> };
    return NextResponse.json({ job: retryJob(sid, id, body?.options) }, { status: 202, headers: noStore });
  },
  { mutating: true },
);
