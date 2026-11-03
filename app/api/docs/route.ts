import type { NextRequest } from "next/server";
import { route, rateLimit, sessionId } from "@/lib/server/http";
import { requireUser } from "@/lib/server/cloud/auth";
import { addFromSession, listDocuments, revision } from "@/lib/server/cloud/docs";
import { body, json } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The library: ?view=all|recent|favorites|shared|trash &folder= &q= &sort=updated|name|size|created &dir=asc|desc. ?rev=1 returns only the sync revision. */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser(req);
  const p = req.nextUrl.searchParams;
  if (p.get("rev")) return json({ rev: await revision(user) });
  return json(await listDocuments(user, { view: p.get("view"), folderId: p.get("folder"), q: p.get("q"), sort: p.get("sort"), dir: p.get("dir") }));
});

/** Saves a file from this browser session (just uploaded, or a tool's result) to the library. */
export const POST = route(
  async (req: NextRequest) => {
    const user = await requireUser(req);
    rateLimit(`save:${user.id}`, 60);
    const b = await body(req);
    return json({ document: await addFromSession(user, sessionId(req), b.fileId, { folderId: b.folderId, name: b.name }) }, 201);
  },
  { mutating: true },
);
