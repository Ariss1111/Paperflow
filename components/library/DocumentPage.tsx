"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ArrowLeft, ChevronDown, Download, FilePen, History, Info, RotateCcw, Share2, Star, Trash2, Wand2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Segmented } from "@/components/ui/controls";
import { useConfirm } from "@/components/ui/dialog";
import { Badge, Notice, toast } from "@/components/ui/feedback";
import { DocViewer } from "@/components/ai/DocViewer";
import { useAccount } from "@/lib/client/account";
import { cloudApi, type Detail } from "@/lib/client/cloud";
import { FORMATS } from "@/lib/formats";
import { cn, formatBytes, formatRelative, withQuery } from "@/lib/utils";
import { ShareDialog } from "./ShareDialog";

const TOOLS = [
  { label: "PDF Editor", href: "/editor", pdf: true },
  { label: "AI Workspace", href: "/ai", pdf: false },
  { label: "Compress PDF", href: "/tools/compress", pdf: true },
  { label: "Organize Pages", href: "/tools/organize", pdf: true },
  { label: "Sign PDF", href: "/tools/sign", pdf: true },
  { label: "OCR (make searchable)", href: "/tools/ocr", pdf: true },
  { label: "Protect PDF", href: "/tools/protect", pdf: true },
];

const EVENT: Record<string, (d: Record<string, unknown>) => string> = {
  uploaded: () => "Uploaded",
  version: (d) => `Saved version ${d.version}${d.note && d.note !== "Edited" ? ` (${d.note})` : ""}`,
  restored: (d) => `Restored version ${d.version}`,
  renamed: (d) => `Renamed from “${d.from}”`,
  moved: () => "Moved to another folder",
  downloaded: (d) => (d.version ? `Downloaded version ${d.version}` : "Downloaded"),
  shared: (d) => `Created a ${d.access === "private" ? "private" : "share"} link${d.password ? " with a password" : ""}${d.download === false ? ", view only" : ""}`,
  share_revoked: () => "Revoked a share link",
  trashed: () => "Moved to the Trash",
  untrashed: () => "Restored from the Trash",
};

export function DocumentPage({ id }: { id: string }) {
  const router = useRouter();
  const { loaded, user } = useAccount();
  const [d, setD] = React.useState<Detail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<"details" | "history">("details");
  const [share, setShare] = React.useState(false);
  const { confirm, element } = useConfirm();

  const load = React.useCallback(() => cloudApi.detail(id).then(setD, (e) => setError((e as Error).message)), [id]);
  React.useEffect(() => {
    if (loaded && user) void load();
  }, [loaded, user, load]);

  if (loaded && !user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="mb-4 text-ink-2">Sign in to open your documents.</p>
        <Link href={`/signin?next=/documents/${id}`} className="inline-flex h-10 items-center rounded-full bg-accent px-5 font-medium text-white">
          Sign in
        </Link>
      </div>
    );
  }
  if (error)
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <Notice tone="danger" title="Can't open this document">{error}</Notice>
        <Link href="/files" className="mt-4 inline-block text-accent hover:underline">Back to My Documents</Link>
      </div>
    );
  if (!d) return <p className="py-20 text-center text-sm text-ink-3">Loading…</p>;
  const doc = d.document;
  const trashed = !!doc.deletedAt;

  const openIn = async (href: string, version?: number) => {
    try {
      const { file } = await cloudApi.open(doc.id, version);
      router.push(withQuery(href, `files=${file.id}${version ? "" : `&doc=${doc.id}`}`));
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  };

  return (
    <div className="flex h-[calc(100dvh-56px)] min-h-0 flex-col">
      {element}
      <header className="flex flex-wrap items-center gap-2 border-b bg-surface/80 px-3 py-2 backdrop-blur sm:px-5">
        <IconButton label="Back to My Documents" onClick={() => router.push("/files")}>
          <ArrowLeft className="size-4" />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-ink" title={doc.name}>
            {doc.name}
          </h1>
          <p className="text-xs text-ink-3">
            {formatBytes(doc.size)}
            {doc.pages ? ` · ${doc.pages} pages` : ""} · version {doc.version} · saved {formatRelative(doc.updatedAt)}
          </p>
        </div>
        {!trashed && (
          <>
            <IconButton label={doc.favorite ? "Remove from Favorites" : "Add to Favorites"} active={doc.favorite} onClick={() => cloudApi.update(doc.id, { favorite: !doc.favorite }).then(load)}>
              <Star className={cn("size-4", doc.favorite && "fill-[#ffcc00] text-[#ffcc00]")} />
            </IconButton>
            <Button size="sm" icon={<Share2 className="size-3.5" />} onClick={() => setShare(true)}>
              Share
            </Button>
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button size="sm" icon={<Wand2 className="size-3.5" />}>
                  Open with <ChevronDown className="size-3.5 opacity-60" />
                </Button>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content align="end" sideOffset={6} className="glass z-50 w-56 animate-rise-in rounded-xl p-1.5 shadow-overlay">
                  {TOOLS.filter((t) => !t.pdf || doc.format === "pdf").map((t) => (
                    <Menu.Item key={t.href} onSelect={() => openIn(t.href)} className="cursor-default rounded-lg px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-accent data-[highlighted]:text-white">
                      {t.label}
                    </Menu.Item>
                  ))}
                  <p className="px-2.5 pb-1 pt-1.5 text-2xs leading-4 text-ink-3">Saving in the PDF Editor adds a new version here.</p>
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
            <a href={cloudApi.downloadHref(doc.id)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-white hover:bg-accent/90">
              <Download className="size-3.5" /> Download
            </a>
          </>
        )}
      </header>
      {trashed && (
        <div className="px-4 pt-3">
          <Notice tone="warning">
            This document is in the Trash.{" "}
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => cloudApi.restore(doc.id).then(load)}>
              Restore it
            </button>
          </Notice>
        </div>
      )}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-h-[60vh] min-w-0 lg:min-h-0">
          {!trashed && <DocViewer key={`${doc.id}:${doc.version}`} file={{ id: doc.id, name: doc.name, format: doc.format }} resolve={() => cloudApi.link(doc.id, { inline: true })} />}
        </div>
        <aside className="scroll-thin min-h-0 space-y-4 overflow-y-auto border-l bg-surface p-4" aria-label="Document information">
          <Segmented<"details" | "history">
            size="sm"
            label="Panel"
            value={tab}
            onChange={setTab}
            options={[
              { value: "details", label: <span className="inline-flex items-center gap-1.5"><Info className="size-3.5" /> Details</span> },
              { value: "history", label: <span className="inline-flex items-center gap-1.5"><History className="size-3.5" /> History</span> },
            ]}
          />
          {tab === "details" ? (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                {[
                  ["Kind", FORMATS[doc.format]?.label ?? doc.format],
                  ["Size", formatBytes(doc.size)],
                  ["Pages", doc.pages ?? "—"],
                  ["Version", doc.version],
                  ["Added", new Date(doc.createdAt).toLocaleString()],
                  ["Modified", new Date(doc.updatedAt).toLocaleString()],
                  ["Opened", doc.openedAt ? new Date(doc.openedAt).toLocaleString() : "—"],
                ].map(([k, v]) => (
                  <React.Fragment key={String(k)}>
                    <dt className="text-ink-3">{k}</dt>
                    <dd className="text-ink">{v}</dd>
                  </React.Fragment>
                ))}
              </dl>
              <section>
                <p className="eyebrow mb-2">Sharing</p>
                {d.shares.filter((s) => s.active).length ? (
                  <ul className="space-y-1 text-sm text-ink-2">
                    {d.shares
                      .filter((s) => s.active)
                      .map((s) => (
                        <li key={s.id} className="flex items-center gap-2">
                          <Badge tone="accent">{s.access === "private" ? "Private" : "Link"}</Badge>
                          <span className="truncate">
                            {s.views} view{s.views === 1 ? "" : "s"}
                            {s.expiresAt ? ` · until ${new Date(s.expiresAt).toLocaleDateString()}` : ""}
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-3">Not shared. Only you can open it.</p>
                )}
                {!trashed && (
                  <Button size="sm" className="mt-2" onClick={() => setShare(true)}>
                    Manage links
                  </Button>
                )}
              </section>
              {!trashed && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  icon={<Trash2 className="size-3.5" />}
                  onClick={async () => {
                    if (!(await confirm(`Move “${doc.name}” to the Trash?`, "Move to Trash", "Its share links stop working. You can restore it from the Trash for 30 days."))) return;
                    await cloudApi.trash(doc.id);
                    toast("Moved to the Trash.", "success");
                    router.push("/files");
                  }}
                >
                  Move to Trash
                </Button>
              )}
            </>
          ) : (
            <>
              <section>
                <p className="eyebrow mb-2">Versions</p>
                <ul className="space-y-1.5" data-testid="versions">
                  {d.versions.map((v) => (
                    <li key={v.version} className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">Version {v.version}</span>
                        {v.version === doc.version && <Badge tone="success">Current</Badge>}
                        <span className="ml-auto text-xs text-ink-3">{formatBytes(v.size)}</span>
                      </div>
                      <p className="text-xs text-ink-3">
                        {v.note} · {formatRelative(v.createdAt)}
                      </p>
                      {!trashed && (
                        <div className="mt-1.5 flex gap-1">
                          <a href={cloudApi.downloadHref(doc.id, v.version)} className="rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10">
                            Download
                          </a>
                          {v.version !== doc.version && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10"
                              onClick={async () => {
                                const r = await cloudApi.restoreVersion(doc.id, v.version);
                                toast(`Version ${v.version} restored as version ${r.document.version}.`, "success");
                                await load();
                              }}
                            >
                              <RotateCcw className="size-3" /> Restore
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <p className="eyebrow mb-2">Activity</p>
                <ol className="space-y-2 border-l pl-3" data-testid="activity">
                  {d.events.map((e, i) => (
                    <li key={i} className="text-sm">
                      <p className="text-ink">{(EVENT[e.kind] ?? (() => e.kind))(e.detail)}</p>
                      <p className="text-xs text-ink-3">{new Date(e.at).toLocaleString()}</p>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
          {doc.format === "pdf" && !trashed && (
            <Button size="sm" className="w-full" icon={<FilePen className="size-3.5" />} onClick={() => openIn("/editor")}>
              Edit in PDF Editor
            </Button>
          )}
        </aside>
      </div>
      <ShareDialog docId={doc.id} name={doc.name} open={share} onOpenChange={setShare} onChange={load} />
    </div>
  );
}
