// The shape of "Smart extraction" results. The AI must answer with JSON matching EXTRACT_SCHEMA
// (enforced by the API's structured outputs), so the results can be shown and exported reliably.

const page = { anyOf: [{ type: "integer" }, { type: "null" }], description: "page number in the whole document, or null" };
const str = { type: "string" };
const item = (props: Record<string, unknown>) => ({ type: "object", properties: { ...props, page }, required: [...Object.keys(props), "page"], additionalProperties: false });
const list = (props: Record<string, unknown>) => ({ type: "array", items: item(props) });

export const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    documentType: { type: "string", description: "what kind of document this is, in a few words" },
    invoiceNumbers: list({ value: str, label: { type: "string", description: "e.g. invoice no., order no., contract no." } }),
    names: list({ value: str, role: { type: "string", description: "e.g. buyer, seller, signatory, employee" }, kind: { type: "string", enum: ["person", "organisation"] } }),
    addresses: list({ value: str, belongsTo: str }),
    dates: list({ value: { type: "string", description: "as written" }, iso: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] }, meaning: str }),
    prices: list({ value: { type: "string", description: "as written, with currency" }, amount: { anyOf: [{ type: "number" }, { type: "null" }] }, currency: { anyOf: [{ type: "string" }, { type: "null" }] }, meaning: str }),
    contacts: list({ type: { type: "string", enum: ["email", "phone", "website", "other"] }, value: str, belongsTo: str }),
    clauses: list({ title: str, summary: str }),
    tables: list({ title: str, columns: { type: "array", items: str }, rows: { type: "array", items: { type: "array", items: str } } }),
  },
  required: ["documentType", "invoiceNumbers", "names", "addresses", "dates", "prices", "contacts", "clauses", "tables"],
  additionalProperties: false,
} as const;

type Page = { page: number | null };
export interface Extraction {
  documentType: string;
  invoiceNumbers: ({ value: string; label: string } & Page)[];
  names: ({ value: string; role: string; kind: "person" | "organisation" } & Page)[];
  addresses: ({ value: string; belongsTo: string } & Page)[];
  dates: ({ value: string; iso: string | null; meaning: string } & Page)[];
  prices: ({ value: string; amount: number | null; currency: string | null; meaning: string } & Page)[];
  contacts: ({ type: "email" | "phone" | "website" | "other"; value: string; belongsTo: string } & Page)[];
  clauses: ({ title: string; summary: string } & Page)[];
  tables: ({ title: string; columns: string[]; rows: string[][] } & Page)[];
}

export const EXTRACT_LISTS = ["invoiceNumbers", "names", "addresses", "dates", "prices", "contacts", "clauses", "tables"] as const;

/** Joins the results of several sections; repeated names, numbers and addresses appear once. */
export function mergeExtractions(parts: Extraction[]): Extraction {
  const out: Extraction = { documentType: parts.find((p) => p.documentType)?.documentType ?? "", invoiceNumbers: [], names: [], addresses: [], dates: [], prices: [], contacts: [], clauses: [], tables: [] };
  const seen = new Set<string>();
  for (const p of parts) {
    for (const k of EXTRACT_LISTS) {
      for (const it of (p[k] ?? []) as (Record<string, unknown> & Page)[]) {
        // the same value repeated across sections is one entry (tables, clauses and prices may legitimately repeat)
        const key = ["names", "addresses", "invoiceNumbers", "contacts"].includes(k) ? `${k}|${String(it.value).toLowerCase().replace(/\s+/g, " ").trim()}` : null;
        if (key) {
          if (seen.has(key)) continue;
          seen.add(key);
        }
        (out[k] as unknown[]).push(it);
      }
    }
  }
  return out;
}
