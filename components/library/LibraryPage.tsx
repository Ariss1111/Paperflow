"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  ArrowDownUp, ChevronRight, Clock, Cloud, Download, FilePen, FolderInput, FolderOpen, FolderPlus, HardDrive, LayoutGrid, List, MoreHorizontal, Pencil, RotateCcw, Search, Share2, Star, Trash2, Upload, Users, X,
} from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/controls";
import { Sheet, useConfirm } from "@/components/ui/dialog";
import { Badge, EmptyState, Notice, toast } from "@/components/ui/feedback";
import { UploadErrors } from "@/components/tool/ToolWorkspace";
import { useUploader } from "@/components/files/useUploader";
import { api } from "@/lib/client/api";
import { savePrefs, type User } from "@/lib/client/account";
import { cloudApi, type CloudDoc, type Folder, type Sort, type StorageStats, type View } from "@/lib/client/cloud";
import { FORMATS } from "@/lib/formats";
import { cn, formatBytes, formatRelative, withQuery } from "@/lib/utils";
import type { StoredFile } from "@/types";
import { ShareDialog } from "./ShareDialog";

const VIEWS: { id: View; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "all", label: "All documents", icon: FolderOpen },
  { id: "recent", label: "Recent", icon: Clock },
  { id: "favorites", label: "Favorites", icon: Star },
  { id: "shared", label: "Shared", icon: Users },
  { id: "trash", label: "Trash", icon: Trash2 },
];
const SORTS: { value: Sort; label: string }[] = [
  { value: "updated", label: "Date modified" },
  { value: "created", label: "Date added" },
  { value: "name", label: "Name" },
  { value: "size", label: "Size" },
];
const ITEM = "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-accent data-[highlighted]:text-white";

const TILE: Record<string, string> = { pdf: "from-[#ff453a] to-[#d70015]", image: "from-[#30d158] to-[#248a3d]", office: "from-[#0a84ff] to-[#0040dd]", other: "from-[#8e8e93] to-[#636366]" };
export function FormatTile({ format, size = 40 }: { format: string; size?: number }) {
  const f = FORMATS[format as keyof typeof FORMATS];
  const kind = f?.kind === "pdf" ? "pdf" : f?.kind === "image" ? "image" : f ? "office" : "other";
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-end justify-center rounded-[22%] bg-gradient-to-b pb-[12%] font-bold uppercase tracking-wide text-white shadow-sm", TILE[kind])} style={{ width: size, height: size * 1.2, fontSize: Math.max(8, size * 0.22) }}>
      {f?.ext ?? "file"}
    </span>
  );
}

function StorageMeter({ s, onDetails }: { s: StorageStats | null; onDetails: () => void }) {
  if (!s) return null;
  const share = Math.min(1, s.used / Math.max(1, s.quota));
  return (
    <button type="button" onClick={onDetails} className="w-full space-y-1.5 rounded-xl p-3 text-left transition-colors hover:bg-ink/[0.04]" data-testid="storage-meter">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
        <HardDrive className="size-3.5 text-ink-3" /> Storage
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
        <div className={cn("h-full rounded-full", share > 0.9 ? "bg-danger" : share > 0.75 ? "bg-warning" : "bg-accent")} style={{ width: `${Math.max(1, share * 100)}%` }} />
      </div>
      <p className="text-xs text-ink-2">
        {formatBytes(s.used)} of {formatBytes(s.quota)} used
      </p>
      <p className="text-xs text-ink-3">
        {s.documents} document{s.documents === 1 ? "" : "s"} · {formatBytes(s.available)} free
      </p>
    </button>
  );
}

type DocAction = "open" | "edit" | "download" | "rename" | "move" | "favorite" | "share" | "trash" | "restore" | "purge";

function DocMenu({ d, trash, onAction }: { d: CloudDoc; trash: boolean; onAction: (a: DocAction, d: CloudDoc) => void }) {
  const item = (a: DocAction, icon: React.ReactNode, label: string, danger = false) => (
    <Menu.Item className={cn(ITEM, danger && "text-danger")} onSelect={() => onAction(a, d)}>
      {icon} {label}
    </Menu.Item>
  );
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton size="sm" label={`Actions for ${d.name}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="size-4" />
        </IconButton>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={4} className="glass z-50 w-56 animate-rise-in rounded-xl p-1.5 shadow-overlay" onClick={(e) => e.stopPropagation()}>
          {trash ? (
            <>
              {item("restore", <RotateCcw className="size-4 opacity-70" />, "Restore")}
              {item("purge", <Trash2 className="size-4 opacity-70" />, "Delete forever", true)}
            </>
          ) : (
            <>
              {item("open", <FolderOpen className="size-4 opacity-70" />, "Open")}
              {d.format === "pdf" && item("edit", <FilePen className="size-4 opacity-70" />, "Edit in PDF Editor")}
              {item("download", <Download className="size-4 opacity-70" />, "Download")}
              <Menu.Separator className="my-1 h-px bg-ink/10" />
              {item("rename", <Pencil className="size-4 opacity-70" />, "Rename")}
              {item("move", <FolderInput className="size-4 opacity-70" />, "Move to…")}
              {item("favorite", <Star className="size-4 opacity-70" />, d.favorite ? "Remove from Favorites" : "Add to Favorites")}
              {item("share", <Share2 className="size-4 opacity-70" />, "Share…")}
              <Menu.Separator className="my-1 h-px bg-ink/10" />
              {item("trash", <Trash2 className="size-4 opacity-70" />, "Move to Trash", true)}
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function LibraryPage({ user }: { user: User }) {
  const router = useRouter();
  const prefs = user.prefs as { sort?: Sort; dir?: "asc" | "desc"; layout?: "grid" | "list" };
  const [view, setView] = React.useState<View>("all");
  const [folderId, setFolderId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState<Sort>(prefs.sort ?? "updated");
  const [dir, setDir] = React.useState<"asc" | "desc">(prefs.dir ?? "desc");
  const [layout, setLayout] = React.useState<"grid" | "list">(prefs.layout ?? "grid");
  const [docs, setDocs] = React.useState<CloudDoc[] | null>(null);
  const [folders, setFolders] = React.useState<Folder[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [storage, setStorage] = React.useState<StorageStats | null>(null);
  const [session, setSession] = React.useState<StoredFile[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const [rename, setRename] = React.useState<{ kind: "doc" | "folder"; id: string; name: string } | null>(null);
  const [move, setMove] = React.useState<CloudDoc | null>(null);
  const [share, setShare] = React.useState<CloudDoc | null>(null);
  const [newFolder, setNewFolder] = React.useState(false);
  const [details, setDetails] = React.useState(false);
  const rev = React.useRef<string | null>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const uploader = useUploader();
  const { confirm, element: confirmEl } = useConfirm();

  // search waits for typing to pause
  React.useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = React.useCallback(async () => {
    try {
      const r = await cloudApi.list({ view, folder: folderId, q, sort, dir });
      setDocs(r.documents);
      setFolders(r.folders);
      rev.current = r.rev;
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      if ((e as { status?: number }).status === 404) setFolderId(null);
    }
    cloudApi.storage().then(setStorage).catch(() => undefined);
  }, [view, folderId, q, sort, dir]);
  React.useEffect(() => {
    void load();
  }, [load]);
  const loadSession = React.useCallback(() => api.listFiles().then((r) => setSession(r.files)).catch(() => undefined), []);
  React.useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // stay in sync with changes made on other devices
  React.useEffect(() => {
    const check = () => {
      if (document.hidden) return;
      cloudApi
        .rev()
        .then((r) => {
          if (rev.current && r.rev !== rev.current) void load();
        })
        .catch(() => undefined);
    };
    const t = setInterval(check, 15_000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", check);
    };
  }, [load]);

  const changeSort = (s: Sort, d = dir) => {
    setSort(s);
    setDir(d);
    void savePrefs({ sort: s, dir: d });
  };
  const changeLayout = (l: "grid" | "list") => {
    setLayout(l);
    void savePrefs({ layout: l });
  };

  const uploadFiles = async (list: File[]) => {
    if (!list.length) return;
    const uploaded = await uploader.upload(list);
    let saved = 0;
    for (const f of uploaded) {
      try {
        await cloudApi.save(f.id, view === "all" ? folderId : null);
        await api.deleteFile(f.id).catch(() => undefined);
        saved++;
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}`, "danger");
      }
    }
    if (saved) toast(`${saved} document${saved === 1 ? "" : "s"} saved.`, "success");
    void load();
    void loadSession();
  };

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, "success");
    } catch (e) {
      toast((e as Error).message, "danger");
    }
    void load();
  };

  const openIn = async (d: CloudDoc, href: string) => {
    try {
      const { file } = await cloudApi.open(d.id);
      router.push(withQuery(href, `files=${file.id}&doc=${d.id}`));
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  };

  const byId = new Map(folders.map((f) => [f.id, f]));
  const crumbs: Folder[] = [];
  for (let f = folderId ? byId.get(folderId) : undefined; f; f = f.parentId ? byId.get(f.parentId) : undefined) crumbs.unshift(f);
  const subfolders = view === "all" && !q ? folders.filter((f) => f.parentId === folderId) : [];
  const folderPath = (id: string | null) => {
    const names: string[] = [];
    for (let f = id ? byId.get(id) : undefined; f; f = f.parentId ? byId.get(f.parentId) : undefined) names.unshift(f.name);
    return names.join(" / ") || "All documents";
  };

  const onAction = async (a: DocAction, d: CloudDoc) => {
    if (a === "restore") return act(() => cloudApi.restore(d.id), `“${d.name}” restored.`);
    if (a === "purge") {
      if (await confirm(`Delete “${d.name}” forever?`, "Delete forever", "The document, all its versions and its file are removed. This can't be undone.")) await act(() => cloudApi.purge(d.id), "Deleted forever.");
      return;
    }
    if (a === "open") return router.push(`/documents/${d.id}`);
    if (a === "edit") return openIn(d, "/editor");
    if (a === "download") return void (window.location.href = cloudApi.downloadHref(d.id));
    if (a === "rename") return setRename({ kind: "doc", id: d.id, name: d.name });
    if (a === "move") return setMove(d);
    if (a === "favorite") return act(() => cloudApi.update(d.id, { favorite: !d.favorite }));
    if (a === "share") return setShare(d);
    if (a === "trash") return act(() => cloudApi.trash(d.id), `“${d.name}” moved to the Trash. Its share links stopped working.`);
  };

  const meta = (d: CloudDoc) => [formatBytes(d.size), d.pages ? `${d.pages} page${d.pages === 1 ? "" : "s"}` : null, view === "trash" && d.deletedAt ? `deleted ${formatRelative(d.deletedAt)}` : formatRelative(sort === "created" ? d.createdAt : d.updatedAt)].filter(Boolean).join(" · ");
  const badges = (d: CloudDoc) => (
    <>
      {d.favorite && <Star className="size-3.5 shrink-0 fill-[#ffcc00] text-[#ffcc00]" aria-label="Favorite" />}
      {d.shared && <Badge tone="accent">Shared</Badge>}
      {d.version > 1 && <Badge>v{d.version}</Badge>}
    </>
  );

  const empty =
    view === "trash"
      ? "The Trash is empty. Deleted documents stay here for 30 days."
      : view === "favorites"
        ? "Star documents to find them here."
        : view === "shared"
          ? "Documents with an active share link appear here."
          : view === "recent"
            ? "Documents you open or change appear here."
            : q
              ? `Nothing matches “${q}”.`
              : "Drop files here, or press Upload.";

  return (
    <div
      className="relative mx-auto flex w-full max-w-[1440px] gap-6 px-4 pb-16 pt-6 sm:px-6"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void uploadFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {confirmEl}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-accent/10 backdrop-blur-[1px]">
          <p className="rounded-2xl bg-surface px-6 py-4 text-lg font-semibold text-accent shadow-overlay">Drop to save to {view === "all" ? folderPath(folderId) : "All documents"}</p>
        </div>
      )}

      {/* ---------------------------------------------------------------- sidebar */}
      <aside className="hidden w-56 shrink-0 lg:block">
        <div className="sticky top-20 space-y-4">
          <nav aria-label="Library" className="space-y-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-current={view === v.id ? "page" : undefined}
                onClick={() => {
                  setView(v.id);
                  setFolderId(null);
                  setQuery("");
                }}
                className={cn("flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors", view === v.id ? "bg-accent/10 font-medium text-accent" : "text-ink hover:bg-ink/[0.04]")}
              >
                <v.icon className={cn("size-4", view === v.id ? "text-accent" : "text-ink-3")} />
                {v.label}
              </button>
            ))}
          </nav>
          <div className="rounded-2xl bg-surface shadow-card">
            <StorageMeter s={storage} onDetails={() => setDetails(true)} />
          </div>
          <p className="flex items-start gap-1.5 px-1 text-[11px] leading-4 text-ink-3">
            <Cloud className="mt-px size-3.5 shrink-0" /> Saved to your account and available on every device where you sign in as {user.email}.
          </p>
        </div>
      </aside>

      {/* ---------------------------------------------------------------- main */}
      <section className="min-w-0 flex-1" aria-label="Documents">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center gap-1 text-2xl font-semibold tracking-[-0.022em] text-ink">
              {view === "all" && crumbs.length > 0 ? (
                <>
                  <button type="button" className="text-ink-3 hover:text-ink" onClick={() => setFolderId(null)}>
                    All documents
                  </button>
                  {crumbs.map((c, i) => (
                    <React.Fragment key={c.id}>
                      <ChevronRight className="size-5 shrink-0 text-ink-3" />
                      {i === crumbs.length - 1 ? (
                        <h1 className="truncate">{c.name}</h1>
                      ) : (
                        <button type="button" className="truncate text-ink-3 hover:text-ink" onClick={() => setFolderId(c.id)}>
                          {c.name}
                        </button>
                      )}
                    </React.Fragment>
                  ))}
                </>
              ) : (
                <h1>{q ? "Search results" : VIEWS.find((v) => v.id === view)!.label}</h1>
              )}
            </nav>
          </div>
          {view === "trash" ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              disabled={!docs?.length}
              onClick={async () => {
                if (await confirm("Empty the Trash?", "Empty Trash", "Everything in the Trash is deleted forever, with all versions. This can't be undone.")) await act(() => cloudApi.emptyTrash(), "Trash emptied.");
              }}
            >
              Empty Trash
            </Button>
          ) : (
            <>
              {view === "all" && (
                <Button size="sm" icon={<FolderPlus className="size-4" />} onClick={() => setNewFolder(true)}>
                  New folder
                </Button>
              )}
              <Button size="sm" variant="primary" icon={<Upload className="size-4" />} loading={uploader.uploading} onClick={() => input.current?.click()}>
                Upload
              </Button>
              <input ref={input} type="file" multiple className="sr-only" tabIndex={-1} data-testid="library-upload" onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ""; void uploadFiles(l); }} />
            </>
          )}
        </div>

        {/* views on small screens */}
        <div className="scroll-thin -mx-1 mb-3 flex gap-1 overflow-x-auto px-1 lg:hidden">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" onClick={() => { setView(v.id); setFolderId(null); }} className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm", view === v.id ? "bg-accent text-white" : "bg-surface text-ink shadow-hairline")}>
              <v.icon className="size-3.5" /> {v.label}
            </button>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <Input type="search" aria-label="Search documents" placeholder="Search all documents" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8 [&::-webkit-search-cancel-button]:hidden" />
            {query && (
              <IconButton size="sm" label="Clear search" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setQuery("")}>
                <X className="size-3.5" />
              </IconButton>
            )}
          </div>
          {view !== "recent" && (
            <div className="flex items-center gap-1">
              <Select aria-label="Sort by" value={sort} onChange={(e) => changeSort(e.target.value as Sort, e.target.value === "name" ? "asc" : "desc")} className="h-9 w-auto">
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <IconButton label={dir === "asc" ? "Ascending" : "Descending"} onClick={() => changeSort(sort, dir === "asc" ? "desc" : "asc")}>
                <ArrowDownUp className={cn("size-4 transition-transform", dir === "asc" && "rotate-180")} />
              </IconButton>
            </div>
          )}
          <div className="flex rounded-lg bg-ink/[0.05] p-0.5">
            <IconButton size="sm" label="Grid view" active={layout === "grid"} onClick={() => changeLayout("grid")}>
              <LayoutGrid className="size-4" />
            </IconButton>
            <IconButton size="sm" label="List view" active={layout === "list"} onClick={() => changeLayout("list")}>
              <List className="size-4" />
            </IconButton>
          </div>
        </div>

        <UploadErrors errors={uploader.errors} onDismiss={uploader.clearErrors} />
        {error && <Notice tone="danger" className="mb-4">{error}</Notice>}

        {subfolders.length > 0 && (
          <ul className={cn("mb-4", layout === "grid" ? "grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]" : "divide-y overflow-hidden rounded-2xl bg-surface shadow-card")} aria-label="Folders">
            {subfolders.map((f) => (
              <li key={f.id} className={cn("group flex items-center gap-2.5", layout === "grid" ? "rounded-2xl bg-surface px-3 py-2.5 shadow-card" : "px-4 py-2.5")} data-testid="folder">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => setFolderId(f.id)}>
                  <FolderOpen className="size-5 shrink-0 fill-[#5ac8fa]/30 text-[#0a84ff]" />
                  <span className="truncate text-sm font-medium text-ink">{f.name}</span>
                </button>
                <Menu.Root>
                  <Menu.Trigger asChild>
                    <IconButton size="sm" label={`Actions for folder ${f.name}`}>
                      <MoreHorizontal className="size-4" />
                    </IconButton>
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Content align="end" sideOffset={4} className="glass z-50 w-48 animate-rise-in rounded-xl p-1.5 shadow-overlay">
                      <Menu.Item className={ITEM} onSelect={() => setRename({ kind: "folder", id: f.id, name: f.name })}>
                        <Pencil className="size-4 opacity-70" /> Rename
                      </Menu.Item>
                      <Menu.Item
                        className={cn(ITEM, "text-danger")}
                        onSelect={async () => {
                          if (await confirm(`Delete the folder “${f.name}”?`, "Delete folder", "Only the folder is removed. Its documents and subfolders move up one level.")) await act(() => cloudApi.deleteFolder(f.id), "Folder deleted.");
                        }}
                      >
                        <Trash2 className="size-4 opacity-70" /> Delete folder
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Portal>
                </Menu.Root>
              </li>
            ))}
          </ul>
        )}

        {docs === null ? (
          <p className="py-16 text-center text-sm text-ink-3">Loading…</p>
        ) : docs.length === 0 && subfolders.length === 0 ? (
          <div className="rounded-[18px] bg-surface shadow-card">
            <EmptyState icon={<FolderOpen className="size-5" />} title={view === "all" && !q ? "Nothing here yet" : "No documents"} action={view === "all" && !q ? <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => input.current?.click()}>Upload documents</Button> : undefined}>
              {empty}
            </EmptyState>
          </div>
        ) : layout === "grid" ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]" aria-label="Documents list">
            {docs.map((d) => (
              <li key={d.id} className="group relative flex flex-col rounded-2xl bg-surface p-3 shadow-card transition-shadow hover:shadow-raised" data-testid="doc">
                <button type="button" className="flex flex-1 flex-col items-start gap-3 text-left" onClick={() => view !== "trash" && router.push(`/documents/${d.id}`)}>
                  <span className="flex h-24 w-full items-center justify-center rounded-xl bg-surface-2">
                    <FormatTile format={d.format} size={44} />
                  </span>
                  <span className="w-full">
                    <span className="line-clamp-2 break-words text-sm font-medium text-ink" title={d.name}>
                      {d.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-3">{meta(d)}</span>
                  </span>
                </button>
                <div className="mt-2 flex items-center gap-1.5">
                  {badges(d)}
                  <span className="ml-auto">
                    <DocMenu d={d} trash={view === "trash"} onAction={onAction} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl bg-surface shadow-card" aria-label="Documents list">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-ink/[0.02]" data-testid="doc">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => view !== "trash" && router.push(`/documents/${d.id}`)}>
                  <FormatTile format={d.format} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{d.name}</span>
                    <span className="block text-xs text-ink-3">{meta(d)}</span>
                  </span>
                </button>
                <span className="hidden items-center gap-1.5 sm:flex">{badges(d)}</span>
                <DocMenu d={d} trash={view === "trash"} onAction={onAction} />
              </li>
            ))}
          </ul>
        )}

        {/* ---------------------------------------------------------------- this browser's working files */}
        {view === "all" && !folderId && !q && session.length > 0 && (
          <section className="mt-10" aria-label="Files in this browser session">
            <h2 className="mb-1 text-sm font-semibold text-ink">Not saved yet</h2>
            <p className="mb-3 text-xs text-ink-3">Files you used in tools during this visit. They&apos;re deleted automatically unless you save them.</p>
            <ul className="divide-y overflow-hidden rounded-2xl bg-surface shadow-card">
              {session.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-4 py-2.5" data-testid="session-file">
                  <FormatTile format={f.format} size={22} />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{f.name}</span>
                  <span className="hidden text-xs text-ink-3 sm:inline">{formatBytes(f.size)}</span>
                  <Button
                    size="sm"
                    icon={<Cloud className="size-3.5" />}
                    onClick={() =>
                      act(async () => {
                        await cloudApi.save(f.id, null);
                        await api.deleteFile(f.id).catch(() => undefined);
                        void loadSession();
                      }, `“${f.name}” saved.`)
                    }
                  >
                    Save
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>

      {/* ---------------------------------------------------------------- dialogs */}
      <Sheet
        open={!!rename}
        onOpenChange={(o) => !o && setRename(null)}
        title={rename?.kind === "folder" ? "Rename folder" : "Rename document"}
        footer={
          <>
            <Button onClick={() => setRename(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={async () => {
                const r = rename!;
                setRename(null);
                await act(() => (r.kind === "folder" ? cloudApi.renameFolder(r.id, r.name) : cloudApi.update(r.id, { name: r.name })), "Renamed.");
              }}
            >
              Rename
            </Button>
          </>
        }
      >
        <Field label="Name" htmlFor="rename-input">
          <Input id="rename-input" autoFocus value={rename?.name ?? ""} maxLength={180} onChange={(e) => setRename((r) => (r ? { ...r, name: e.target.value } : r))} onFocus={(e) => e.currentTarget.setSelectionRange(0, e.currentTarget.value.replace(/\.[^.]+$/, "").length)} />
        </Field>
      </Sheet>

      <NewFolderDialog
        open={newFolder}
        onOpenChange={setNewFolder}
        where={folderPath(folderId)}
        onCreate={(name) => act(() => cloudApi.createFolder(name, folderId), `Folder “${name}” created.`)}
      />

      <Sheet open={!!move} onOpenChange={(o) => !o && setMove(null)} title={`Move “${move?.name ?? ""}”`} description="Choose a folder.">
        <ul className="scroll-thin max-h-[50vh] space-y-0.5 overflow-y-auto" aria-label="Folders">
          {[null, ...folders.map((f) => f.id)].map((id) => (
            <li key={id ?? "root"}>
              <button
                type="button"
                disabled={move?.folderId === id}
                onClick={async () => {
                  const d = move!;
                  setMove(null);
                  await act(() => cloudApi.update(d.id, { folderId: id }), `Moved to ${folderPath(id)}.`);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-ink/[0.04] disabled:opacity-40"
              >
                <FolderOpen className="size-4 shrink-0 text-[#0a84ff]" /> {folderPath(id)}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      {share && <ShareDialog docId={share.id} name={share.name} open={!!share} onOpenChange={(o) => !o && setShare(null)} onChange={load} />}

      <Sheet open={details} onOpenChange={setDetails} title="Storage" className="w-[min(520px,calc(100vw-32px))]">
        {storage && (
          <div className="space-y-5" data-testid="storage-details">
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Used", formatBytes(storage.used)],
                ["Available", formatBytes(storage.available)],
                ["Documents", String(storage.documents)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-surface-2 p-3">
                  <p className="text-lg font-semibold text-ink">{v}</p>
                  <p className="text-xs text-ink-3">{k}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-ink-2">
              Your plan includes {formatBytes(storage.quota)}. Older versions ({storage.versions - storage.documents - storage.trash > 0 ? storage.versions - storage.documents - storage.trash : 0}) and the Trash ({storage.trash} document{storage.trash === 1 ? "" : "s"}) count too; the Trash empties itself after 30 days.
            </p>
            <section>
              <p className="eyebrow mb-2">Largest documents</p>
              <ul className="space-y-1">
                {storage.largest.map((d) => (
                  <li key={d.id}>
                    <Link href={`/documents/${d.id}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-ink/[0.04]">
                      <FormatTile format={d.format} size={18} />
                      <span className="min-w-0 flex-1 truncate text-ink">{d.name}</span>
                      <span className="text-xs tabular-nums text-ink-3">{formatBytes(d.size)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <p className="eyebrow mb-2">Recent uploads</p>
              <ul className="space-y-1">
                {storage.recent.map((d) => (
                  <li key={d.id}>
                    <Link href={`/documents/${d.id}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-ink/[0.04]">
                      <FormatTile format={d.format} size={18} />
                      <span className="min-w-0 flex-1 truncate text-ink">{d.name}</span>
                      <span className="text-xs text-ink-3">{formatRelative(d.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function NewFolderDialog({ open, onOpenChange, where, onCreate }: { open: boolean; onOpenChange: (o: boolean) => void; where: string; onCreate: (name: string) => void }) {
  const [name, setName] = React.useState("");
  React.useEffect(() => {
    if (open) setName("");
  }, [open]);
  const submit = () => {
    if (!name.trim()) return;
    onOpenChange(false);
    onCreate(name.trim());
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="New folder"
      description={`In ${where}`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={submit}>
            Create
          </Button>
        </>
      }
    >
      <Field label="Folder name" htmlFor="folder-name">
        <Input id="folder-name" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </Field>
    </Sheet>
  );
}
