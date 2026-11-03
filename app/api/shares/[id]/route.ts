import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/cloud/auth";
import { updateShare } from "@/lib/server/cloud/docs";
import { body, json } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** {revoke: true}, or changes to {allowDownload, expiresAt, password}. */
export const PATCH = route<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => json({ share: await updateShare(await requireUser(req), (await params).id, await body(req)) }),
  { mutating: true },
);
