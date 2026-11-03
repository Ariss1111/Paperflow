import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/cloud/auth";
import { emptyTrash } from "@/lib/server/cloud/docs";
import { json } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = route(async (req) => json({ deleted: await emptyTrash(await requireUser(req)) }), { mutating: true });
