import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { devMailbox } from "@/lib/server/cloud/config";
import { devInbox } from "@/lib/server/cloud/mail";
import { json } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The development inbox. Doesn't exist in production (unless DEV_MAILBOX=1 is set on purpose). */
export const GET = route(async () => {
  if (!devMailbox()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return json({ messages: (await devInbox()).map((m) => ({ id: m.id, to: m.to_addr, subject: m.subject, text: m.text_body, at: new Date(m.created_at).getTime() })) });
});
