// Client-side copies of the shapes the AI and comparison APIs return.

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

export type Seg = { op: "same" | "add" | "del"; text: string };
export type Pair = { from: string; to: string };
export interface CompareItem {
  kind: "same" | "added" | "removed" | "changed" | "format";
  a?: { text: string; page: number };
  b?: { text: string; page: number };
  words?: Seg[];
  dates?: Pair[];
  numbers?: Pair[];
  format?: string[];
}
export interface CompareResult {
  a: { name: string; pages: number };
  b: { name: string; pages: number };
  summary: { added: number; removed: number; changed: number; formatting: number; dates: number; numbers: number; unchanged: number };
  items: CompareItem[];
}

export interface AiUsage {
  available: boolean;
  provider: string | null;
  model: string | null;
  usage: {
    plan: { id: string; label: string; dailyRequests: number; dailyTokens: number; maxFileBytes: number; maxPages: number };
    requests: number;
    tokens: number;
    resetsAt: string;
  };
}
