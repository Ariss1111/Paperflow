import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/cloud/auth";
import { updateFolder, deleteFolder } from "@/lib/server/cloud/docs";
import { body, json } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** {name} and/or {parentId} (null = top level). */
export const PATCH = route<Ctx>(
  async (req, { params }) => {
    const b = await body(req);
    await updateFolder(await requireUser(req), (await params).id, { name: b.name, parentId: b.parentId });
    return json({ ok: true });
  },
  { mutating: true },
);

/** Deletes the folder; its documents and subfolders move up a level. */
export const DELETE = route<Ctx>(
  async (req, { params }) => {
    await deleteFolder(await requireUser(req), (await params).id);
    return json({ ok: true });
  },
  { mutating: true },
);
