import { route, rateLimit, sessionId } from "@/lib/server/http";
import { requireUser } from "@/lib/server/cloud/auth";
import { addVersion, restoreVersion } from "@/lib/server/cloud/docs";
import { body, json } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** {fileId}: saves a session file as the new version. {restore: N}: brings back version N (as a new version). */
export const POST = route<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const user = await requireUser(req);
    rateLimit(`ver:${user.id}`, 30);
    const { id } = await params;
    const b = await body(req);
    if (b.restore !== undefined) return json({ document: await restoreVersion(user, id, b.restore) });
    return json({ document: await addVersion(user, id, sessionId(req), b.fileId, typeof b.note === "string" ? b.note : "Edited") });
  },
  { mutating: true },
);
