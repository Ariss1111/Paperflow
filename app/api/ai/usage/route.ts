import { NextResponse, type NextRequest } from "next/server";
import { route, sessionId } from "@/lib/server/http";
import { aiConfigured, aiProviderLabel, usageFor, AI_MODEL } from "@/lib/server/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** This visitor's AI allowance and what they've used today, plus where documents go. */
export const GET = route(async (req: NextRequest) => {
  const available = aiConfigured();
  return NextResponse.json(
    { available, provider: available ? aiProviderLabel() : null, model: available ? AI_MODEL : null, usage: usageFor(sessionId(req)) },
    { headers: { "Cache-Control": "no-store" } },
  );
});
