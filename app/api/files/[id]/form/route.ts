import fsp from "node:fs/promises";
import { NextResponse } from "next/server";
import { route, sessionId, noStore } from "@/lib/server/http";
import { getFile } from "@/lib/server/store";
import { readForm } from "@/lib/pdf/ops";
import { UserError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Lists the AcroForm fields of an uploaded PDF so the Fill Form tool can render inputs. */
export const GET = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const f = getFile(sessionId(req), id);
  if (f.meta.format !== "pdf") throw new UserError("Only PDFs have form fields.");
  const form = await readForm(new Uint8Array(await fsp.readFile(f.path)));
  return NextResponse.json(form, { headers: noStore });
});
