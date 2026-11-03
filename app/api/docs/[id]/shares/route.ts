import { route, rateLimit } from "@/lib/server/http";
import { requireUser } from "@/lib/server/cloud/auth";
import { createShare, listShares } from "@/lib/server/cloud/docs";
import { body, json } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { documentDetail } = await import("@/lib/server/cloud/docs");
  const { document } = await documentDetail(user, (await params).id);
  return json({ shares: await listShares(user, document.id) });
});

/** {access: "link"|"private", emails?, password?, allowDownload?, expiresAt?} */
export const POST = route<Ctx>(
  async (req, { params }) => {
    const user = await requireUser(req);
    rateLimit(`share:${user.id}`, 20);
    return json({ share: await createShare(user, (await params).id, await body(req)) }, 201);
  },
  { mutating: true },
);
