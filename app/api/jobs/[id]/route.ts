import { NextResponse } from "next/server";
import { route, sessionId, noStore } from "@/lib/server/http";
import { getJob } from "@/lib/server/store";
import { cancelJob } from "@/lib/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  return NextResponse.json({ job: getJob(sessionId(req), id).job }, { headers: noStore });
});

/** Cancels a queued or running job. */
export const DELETE = route<Ctx>(
  async (req, { params }) => {
    const { id } = await params;
    return NextResponse.json({ job: cancelJob(sessionId(req), id) }, { headers: noStore });
  },
  { mutating: true },
);
