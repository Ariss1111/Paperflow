import type { NextRequest } from "next/server";
import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/cloud/auth";
import { documentDetail, updateDocument, trashDocument, purgeDocument, restoreDocument } from "@/lib/server/cloud/docs";
import { body, json } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Details, versions, activity and share links. */
export const GET = route<Ctx>(async (req, { params }) => json(await documentDetail(await requireUser(req), (await params).id)));

/** {name}, {folderId} (null = top level), {favorite}, or {restore: true} for a document in the trash. */
export const PATCH = route<Ctx>(
  async (req, { params }) => {
    const user = await requireUser(req);
    const { id } = await params;
    const b = await body(req);
    if (b.restore === true) {
      await restoreDocument(user, id);
      return json({ ok: true });
    }
    return json({ document: await updateDocument(user, id, { name: b.name, folderId: b.folderId, favorite: b.favorite }) });
  },
  { mutating: true },
);

/** Moves to the trash; ?forever=1 deletes a trashed document for good. */
export const DELETE = route<Ctx>(
  async (req: NextRequest, { params }) => {
    const user = await requireUser(req);
    const { id } = await params;
    if (req.nextUrl.searchParams.get("forever")) await purgeDocument(user, id);
    else await trashDocument(user, id);
    return json({ ok: true });
  },
  { mutating: true },
);
