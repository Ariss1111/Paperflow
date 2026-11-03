import { route, rateLimit, sessionId } from "@/lib/server/http";
import { requireUser } from "@/lib/server/cloud/auth";
import { openInSession } from "@/lib/server/cloud/docs";
import { body, json } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Makes a working copy in this browser session so tools and the editor can use it. */
export const POST = route<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const user = await requireUser(req);
    rateLimit(`open:${user.id}`, 60);
    const b = await body(req);
    return json({ file: await openInSession(user, sessionId(req), (await params).id, b.version) });
  },
  { mutating: true },
);
