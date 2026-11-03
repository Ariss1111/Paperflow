"use client";
import * as React from "react";
import { Braces, FileSpreadsheet, ListChecks, Loader2, Square, Table2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Select } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { baseName } from "@/lib/utils";
import type { StoredFile } from "@/types";
import { LANGUAGES } from "./RunPanel";
import { saveFile, useAiRun } from "./stream";
import type { Extraction } from "./types";

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** Everything but tables as one sheet: category, value, details, page. */
export function extractionRows(x: Extraction): unknown[][] {
  const rows: unknown[][] = [["Category", "Value", "Details", "Page"]];
  if (x.documentType) rows.push(["Document type", x.documentType, "", ""]);
  x.invoiceNumbers.forEach((i) => rows.push(["Invoice / reference number", i.value, i.label, i.page]));
  x.names.forEach((i) => rows.push([i.kind === "organisation" ? "Organisation" : "Person", i.value, i.role, i.page]));
  x.addresses.forEach((i) => rows.push(["Address", i.value, i.belongsTo, i.page]));
  x.dates.forEach((i) => rows.push(["Date", i.value, [i.meaning, i.iso].filter(Boolean).join(" · "), i.page]));
  x.prices.forEach((i) => rows.push(["Price / amount", i.value, i.meaning, i.page]));
  x.contacts.forEach((i) => rows.push([`Contact (${i.type})`, i.value, i.belongsTo, i.page]));
  x.clauses.forEach((i) => rows.push(["Clause", i.title, i.summary, i.page]));
  return rows;
}

function PageLink({ page, onPage }: { page: number | null; onPage: (p: number) => void }) {
  if (!page) return null;
  return (
    <button type="button" onClick={() => onPage(page)} className="shrink-0 rounded bg-accent/10 px-1.5 text-xs font-medium text-accent hover:bg-accent/20">
      p. {page}
    </button>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
        {title} <span className="rounded-full bg-surface-2 px-1.5 text-2xs font-semibold text-ink-3">{count}</span>
      </h3>
      {count ? children : <p className="text-sm text-ink-3">None found.</p>}
    </section>
  );
}

const Row = ({ value, detail, page, onPage }: { value: string; detail?: string; page: number | null; onPage: (p: number) => void }) => (
  <li className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
    <div className="min-w-0 flex-1">
      <p className="break-words font-medium text-ink">{value}</p>
      {detail && <p className="text-xs text-ink-2">{detail}</p>}
    </div>
    <PageLink page={page} onPage={onPage} />
  </li>
);

export function ExtractPanel({ file, ready, onPage, onUsage, consent }: { file: StoredFile; ready: boolean; onPage: (p: number) => void; onUsage: (u: { requests: number; tokens: number }) => void; consent: () => Promise<boolean> }) {
  const [language, setLanguage] = React.useState("");
  const { state, run, stop } = useAiRun(onUsage);
  const x = state.data;
  const stem = `${baseName(file.name)}-extracted`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b p-4">
        <p className="text-sm text-ink-2">Invoice numbers, names, addresses, dates, prices, tables, contact details and important clauses, each with its page.</p>
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1 space-y-1">
            <span className="text-xs font-medium text-ink-2">Describe items in</span>
            <Select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Description language">
              <option value="">Same as the document</option>
              {LANGUAGES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </Select>
          </label>
          {state.busy ? (
            <Button icon={<Square className="size-3" />} onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" icon={<ListChecks className="size-4" />} disabled={!ready} onClick={async () => (await consent()) && run({ fileId: file.id, task: "extract", language })}>
              Extract
            </Button>
          )}
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite" data-testid="ai-extract">
        {!x && !state.busy && !state.error && <p className="py-10 text-center text-sm text-ink-3">Press Extract to find the key data in this document.</p>}
        {state.busy && (
          <p className="flex items-center gap-2 text-sm text-ink-3">
            <Loader2 className="size-4 animate-spin" /> {state.progress || "Reading the document…"}
          </p>
        )}
        {state.notices.map((n) => (
          <Notice key={n} tone="info">
            {n}
          </Notice>
        ))}
        {state.error && (
          <Notice tone="danger" title="That didn't work">
            {state.error}
          </Notice>
        )}
        {x && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink">
                <span className="text-ink-3">Document type:</span> <span className="font-semibold">{x.documentType || "—"}</span>
              </p>
              <div className="flex gap-1">
                <Button size="sm" icon={<FileSpreadsheet className="size-3.5" />} onClick={() => saveFile(`${stem}.csv`, csv(extractionRows(x)), "text/csv;charset=utf-8")}>
                  CSV
                </Button>
                <Button size="sm" icon={<Braces className="size-3.5" />} onClick={() => saveFile(`${stem}.json`, JSON.stringify(x, null, 2), "application/json")}>
                  JSON
                </Button>
              </div>
            </div>
            <Group title="Invoice and reference numbers" count={x.invoiceNumbers.length}>
              <ul className="space-y-1.5">{x.invoiceNumbers.map((i, k) => <Row key={k} value={i.value} detail={i.label} page={i.page} onPage={onPage} />)}</ul>
            </Group>
            <Group title="Names" count={x.names.length}>
              <ul className="space-y-1.5">{x.names.map((i, k) => <Row key={k} value={i.value} detail={[i.kind === "organisation" ? "Organisation" : "Person", i.role].filter(Boolean).join(" · ")} page={i.page} onPage={onPage} />)}</ul>
            </Group>
            <Group title="Addresses" count={x.addresses.length}>
              <ul className="space-y-1.5">{x.addresses.map((i, k) => <Row key={k} value={i.value} detail={i.belongsTo} page={i.page} onPage={onPage} />)}</ul>
            </Group>
            <Group title="Dates" count={x.dates.length}>
              <ul className="space-y-1.5">{x.dates.map((i, k) => <Row key={k} value={i.value} detail={i.meaning} page={i.page} onPage={onPage} />)}</ul>
            </Group>
            <Group title="Prices and amounts" count={x.prices.length}>
              <ul className="space-y-1.5">{x.prices.map((i, k) => <Row key={k} value={i.value} detail={i.meaning} page={i.page} onPage={onPage} />)}</ul>
            </Group>
            <Group title="Contact information" count={x.contacts.length}>
              <ul className="space-y-1.5">{x.contacts.map((i, k) => <Row key={k} value={i.value} detail={[i.type, i.belongsTo].filter(Boolean).join(" · ")} page={i.page} onPage={onPage} />)}</ul>
            </Group>
            <Group title="Important clauses" count={x.clauses.length}>
              <ul className="space-y-1.5">{x.clauses.map((i, k) => <Row key={k} value={i.title} detail={i.summary} page={i.page} onPage={onPage} />)}</ul>
            </Group>
            <Group title="Tables" count={x.tables.length}>
              <div className="space-y-4">
                {x.tables.map((t, k) => (
                  <div key={k} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Table2 className="size-3.5 text-ink-3" />
                      <p className="flex-1 text-sm font-medium text-ink">{t.title || `Table ${k + 1}`}</p>
                      <PageLink page={t.page} onPage={onPage} />
                      <IconButton size="sm" label={`Download table ${k + 1} as CSV`} onClick={() => saveFile(`${stem}-table-${k + 1}.csv`, csv([t.columns, ...t.rows]), "text/csv;charset=utf-8")}>
                        <FileSpreadsheet className="size-3.5" />
                      </IconButton>
                    </div>
                    <div className="scroll-thin overflow-x-auto rounded-lg shadow-hairline">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-surface-2 text-ink-2">
                          <tr>{t.columns.map((c, i) => <th key={i} className="px-2.5 py-1.5 font-semibold">{c}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y">
                          {t.rows.map((r, i) => (
                            <tr key={i}>{r.map((c, j) => <td key={j} className="px-2.5 py-1.5 text-ink">{c}</td>)}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </Group>
          </>
        )}
      </div>
    </div>
  );
}
