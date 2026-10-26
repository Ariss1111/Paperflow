"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as D from "@radix-ui/react-dialog";
import { Home, LayoutGrid, PenLine, ArrowLeftRight, FolderOpen, Settings, Shield, Search, Menu, X, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/brand";
import { TOOLS, toolHref, CATEGORIES } from "@/lib/tools/catalog";
import { ToolGlyph } from "@/components/ToolIcon";
import { Kbd } from "@/components/ui/controls";
import { Toaster } from "@/components/ui/feedback";
import { getSettings, applyTheme } from "@/lib/client/settings";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/tools", label: "All Tools", icon: LayoutGrid },
  { href: "/editor", label: "PDF Editor", icon: PenLine },
  { href: "/convert", label: "Convert", icon: ArrowLeftRight },
  { href: "/files", label: "My Files", icon: FolderOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];
const QUICK = ["merge", "split", "compress", "organize", "sign", "protect"];

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex size-7 items-center justify-center rounded-[8px] bg-gradient-to-b from-[#3b8cff] to-[#0062d6] shadow-[inset_0_0.5px_0_rgb(255_255_255/0.4),0_1px_2px_rgb(0_0_0/0.2)]", className)}>
      <svg viewBox="0 0 24 24" className="size-[15px]" fill="none" aria-hidden>
        <path d="M7 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" fill="white" fillOpacity="0.95" />
        <path d="M8.5 12.5c2-1.6 4-1.6 7 0M8.5 16c2-1.6 4-1.6 7 0" stroke="#0062d6" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarContent({ onNavigate, onSearch }: { onNavigate?: () => void; onSearch: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <Logo />
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{APP_NAME}</span>
      </div>
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={onSearch}
          className="flex h-8 w-full items-center gap-2 rounded-lg bg-ink/[0.05] px-2.5 text-sm text-ink-3 transition-colors hover:bg-ink/[0.08]"
        >
          <Search className="size-3.5" aria-hidden />
          <span className="flex-1 text-left">Search tools</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>
      <nav aria-label="Main" className="scroll-thin flex-1 overflow-y-auto px-3 py-1">
        <ul className="space-y-px">
          {NAV.map(({ href, label, icon: I }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-sm transition-colors duration-100",
                    active ? "bg-ink/[0.08] font-medium text-ink" : "text-ink-2 hover:bg-ink/[0.04] hover:text-ink",
                  )}
                >
                  <I className={cn("size-4", active ? "text-accent" : "text-ink-3")} strokeWidth={1.75} aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="eyebrow mb-1.5 mt-6 px-2.5">Quick tools</p>
        <ul className="space-y-px">
          {QUICK.map((id) => {
            const t = TOOLS.find((x) => x.id === id)!;
            const href = toolHref(t);
            const active = pathname === href;
            return (
              <li key={id}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-8 items-center gap-2.5 rounded-[7px] px-2 text-sm transition-colors duration-100",
                    active ? "bg-ink/[0.08] font-medium text-ink" : "text-ink-2 hover:bg-ink/[0.04] hover:text-ink",
                  )}
                >
                  <ToolGlyph icon={t.icon} category={t.category} size="sm" className="!size-5 !rounded-[6px] [&_svg]:!size-3" />
                  {t.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t px-3 py-3">
        <Link
          href="/privacy"
          onClick={onNavigate}
          className={cn(
            "flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-sm text-ink-2 transition-colors hover:bg-ink/[0.04] hover:text-ink",
            isActive(pathname, "/privacy") && "bg-ink/[0.08] text-ink",
          )}
        >
          <Shield className="size-4 text-ink-3" strokeWidth={1.75} aria-hidden />
          Privacy & Security
        </Link>
      </div>
    </div>
  );
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState(0);
  const results = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    const pages = NAV.map((n) => ({ id: n.href, name: n.label, sub: "Go to page", href: n.href, tool: null }));
    const tools = TOOLS.map((t) => ({ id: t.id, name: t.name, sub: t.tagline, href: toolHref(t), tool: t }));
    const all = [...tools, ...pages];
    if (!s) return tools.filter((t) => t.tool?.popular).slice(0, 8);
    return all
      .map((r) => {
        const hay = `${r.name} ${r.sub} ${r.tool ? CATEGORIES.find((c) => c.id === r.tool!.category)?.label : ""}`.toLowerCase();
        const score = r.name.toLowerCase().startsWith(s) ? 3 : r.name.toLowerCase().includes(s) ? 2 : hay.includes(s) ? 1 : 0;
        return { r, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((x) => x.r);
  }, [q]);
  React.useEffect(() => setSel(0), [q]);
  React.useEffect(() => {
    if (!open) setQ("");
  }, [open]);
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/20 dark:bg-black/45" />
        <D.Content className="glass fixed left-1/2 top-[14vh] z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 animate-sheet-in overflow-hidden rounded-2xl shadow-overlay focus:outline-none">
          <D.Title className="sr-only">Search tools</D.Title>
          <D.Description className="sr-only">Type to filter tools and pages, use arrow keys and Enter to open.</D.Description>
          <div className="flex items-center gap-3 border-b px-4">
            <Search className="size-4 text-ink-3" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSel((s) => Math.min(results.length - 1, s + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSel((s) => Math.max(0, s - 1));
                } else if (e.key === "Enter" && results[sel]) go(results[sel].href);
              }}
              placeholder="Search tools — merge, compress, sign…"
              aria-label="Search tools"
              aria-controls="palette-results"
              aria-activedescendant={results[sel] ? `pal-${results[sel].id}` : undefined}
              className="h-12 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none"
            />
          </div>
          <ul id="palette-results" role="listbox" className="scroll-thin max-h-[50vh] overflow-y-auto p-2">
            {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-3">No tools match “{q}”.</li>}
            {results.map((r, i) => (
              <li
                key={r.id}
                id={`pal-${r.id}`}
                role="option"
                aria-selected={i === sel}
                onMouseEnter={() => setSel(i)}
                onClick={() => go(r.href)}
                className={cn("flex cursor-default items-center gap-3 rounded-[9px] px-2.5 py-2", i === sel && "bg-accent text-accent-ink")}
              >
                {r.tool ? (
                  <ToolGlyph icon={r.tool.icon} category={r.tool.category} size="sm" className={cn(i === sel && "!bg-white/20 !text-white")} />
                ) : (
                  <span className="size-7" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.name}</span>
                  <span className={cn("block truncate text-xs", i === sel ? "text-white/75" : "text-ink-3")}>{r.sub}</span>
                </span>
                {i === sel && <CornerDownLeft className="size-3.5 opacity-80" aria-hidden />}
              </li>
            ))}
          </ul>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = React.useState(false);
  const [palette, setPalette] = React.useState(false);
  const pathname = usePathname();
  const fullBleed = pathname.startsWith("/editor") || pathname === "/tools/sign" || pathname === "/tools/edit";

  React.useEffect(() => applyTheme(getSettings().theme), []);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  React.useEffect(() => setDrawer(false), [pathname]);

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-raised">
        Skip to content
      </a>
      <aside className="sidebar-surface sticky top-0 hidden h-dvh w-[232px] shrink-0 border-r lg:block">
        <SidebarContent onSearch={() => setPalette(true)} />
      </aside>

      {/* Mobile / tablet top bar */}
      <div className="glass fixed inset-x-0 top-0 z-40 flex h-12 items-center gap-2 border-b px-2 lg:hidden">
        <button type="button" aria-label="Open navigation" onClick={() => setDrawer(true)} className="inline-flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-ink/[0.06]">
          <Menu className="size-5" />
        </button>
        <Link href="/" className="flex items-center gap-2">
          <Logo className="size-6" />
          <span className="text-[15px] font-semibold text-ink">{APP_NAME}</span>
        </Link>
        <button type="button" aria-label="Search tools" onClick={() => setPalette(true)} className="ml-auto inline-flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-ink/[0.06]">
          <Search className="size-[18px]" />
        </button>
      </div>
      <D.Root open={drawer} onOpenChange={setDrawer}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/30 lg:hidden" />
          <D.Content className="fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] animate-drawer-in bg-[rgb(var(--sidebar-bg))] shadow-overlay focus:outline-none lg:hidden">
            <D.Title className="sr-only">Navigation</D.Title>
            <D.Description className="sr-only">Main navigation</D.Description>
            <button type="button" aria-label="Close navigation" onClick={() => setDrawer(false)} className="absolute right-2 top-3 inline-flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/[0.06]">
              <X className="size-4" />
            </button>
            <SidebarContent
              onNavigate={() => setDrawer(false)}
              onSearch={() => {
                setDrawer(false);
                setPalette(true);
              }}
            />
          </D.Content>
        </D.Portal>
      </D.Root>

      <main id="main" className={cn("min-w-0 flex-1 pt-12 lg:pt-0", fullBleed && "flex flex-col")}>
        {children}
      </main>
      <CommandPalette open={palette} onOpenChange={setPalette} />
      <Toaster />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-6 pt-8 sm:pt-10">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-[-0.022em] text-ink sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-base text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Container({ children, className, wide }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-4 pb-16 sm:px-8", wide ? "max-w-[1240px]" : "max-w-[1040px]", className)}>{children}</div>;
}
