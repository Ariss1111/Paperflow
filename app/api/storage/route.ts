import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/cloud/auth";
import { storageStats } from "@/lib/server/cloud/docs";
import { json } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => json(await storageStats(await requireUser(req))));
