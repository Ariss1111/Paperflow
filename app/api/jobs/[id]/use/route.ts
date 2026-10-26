import { NextResponse, type NextRequest } from "next/server";
import { route, sessionId, noStore } from "@/lib/server/http";
import { outputToFile } from "@/lib/server/jobs";
import { UserError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Turns a job result into a new session file ("Continue with another tool"). */
export const POST = route<Ctx>(
  async (req: NextRequest, { params }) => {
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { index?: unknown } | null;
    const index = Number(body?.index ?? 0);
    if (!Number.isInteger(index) || index < 0) throw new UserError("Invalid result index.");
    return NextResponse.json({ file: await outputToFile(sessionId(req), id, index) }, { headers: noStore });
  },
  { mutating: true },
);
