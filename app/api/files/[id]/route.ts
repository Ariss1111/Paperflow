import { NextResponse, type NextRequest } from "next/server";
import { route, sessionId, noStore } from "@/lib/server/http";
import { getFile, deleteFile, renameFile } from "@/lib/server/store";
import { UserError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  return NextResponse.json({ file: getFile(sessionId(req), id).meta }, { headers: noStore });
});

export const PATCH = route<Ctx>(
  async (req: NextRequest, { params }) => {
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
    if (!body || typeof body.name !== "string" || !body.name.trim()) throw new UserError("Enter a file name.");
    return NextResponse.json({ file: renameFile(sessionId(req), id, body.name) }, { headers: noStore });
  },
  { mutating: true },
);

export const DELETE = route<Ctx>(
  async (req, { params }) => {
    const { id } = await params;
    await deleteFile(sessionId(req), id);
    return NextResponse.json({ ok: true }, { headers: noStore });
  },
  { mutating: true },
);
