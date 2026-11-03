import { route, rateLimit } from "@/lib/server/http";
import { requireUser } from "@/lib/server/cloud/auth";
import { createFolder } from "@/lib/server/cloud/docs";
import { body, json } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(
  async (req) => {
    const user = await requireUser(req);
    rateLimit(`folder:${user.id}`, 30);
    const b = await body(req);
    return json({ folder: await createFolder(user, b.name, b.parentId) }, 201);
  },
  { mutating: true },
);
