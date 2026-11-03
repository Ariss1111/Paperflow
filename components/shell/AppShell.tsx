"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as D from "@radix-ui/react-dialog";
import { Home, LayoutGrid, PenLine, ScanLine, Sparkles, FolderOpen, Tag, Settings, Shield, Search, Menu, X, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOOLS, toolHref, CATEGORIES } from "@/lib/tools/catalog";
import { ToolGlyph } from "@/components/ToolIcon";
import { Logo } from "@/components/brand/Logo";
import { Kbd } from "@/components/ui/controls";
import { Toaster } from "@/components/ui/feedback";
import { getSettings, applyTheme } from "@/lib/client/settings";
import { AccountButton } from "@/components/account/AccountButton";

export { Logo };

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/tools", label: "All Tools", icon: LayoutGrid },
  { href: "/editor", label: "PDF Editor", icon: PenLine },
  { href: "/scan", label: "Smart Scanner", icon: ScanLine },
  { href: "/ai", label: "AI Workspace", icon: Sparkles },
  { href: "/files", label: "My Documents", icon: FolderOpen },
  { href: "/pricing", label: "Pricing", icon: Tag },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Slim translucent bar: logo, the eight sections, search. Collapses into a drawer below 1280 px. */
function TopNav({ onSearch, onMenu }: { onSearch: () => void; onMenu: () => void }) {
  const pathname = usePathname();
  return (
    <header className="glass fixed inset-x-0 top-0 z-40 border-b">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2 px-3 sm:px-5">
        <button type="button" aria-label="Open navigation" onClick={onMenu} className="inline-flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-ink/[0.06] xl:hidden">
          <Menu className="size-5" />
        </button>
        <Link href="/" aria-label="Pagelyt home" className="mr-2 rounded-lg">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden flex-1 items-center justify-center xl:flex">
          <ul className="flex items-center gap-0.5">
            {NAV.map(({ href, label }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative inline-flex h-9 items-center rounded-full px-3.5 text-[13.5px] font-medium transition-colors duration-150",
                      active ? "bg-accent/[0.1] text-accent" : "text-ink-2 hover:bg-ink/[0.05] hover:text-ink",
                    )}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <button
          type="button"
          onClick={onSearch}
          aria-label="Search tools"
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-full bg-ink/[0.05] px-3 text-sm text-ink-3 transition-colors hover:bg-ink/[0.08] xl:ml-0"
        >
          <Search className="size-4" aria-hidden />
          <span className="hidden sm:inline">Search tools</span>
          <span className="hidden sm:inline">
            <Kbd>⌘K</Kbd>
          </span>
        </button>
        <AccountButton />
      </div>
    </header>
  );
}

function Drawer({ open, onOpenChange, onSearch }: { open: boolean; onOpenChange: (o: boolean) => void; onSearch: () => void }) {
  const pathname = usePathname();
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/30" />
        <D.Content className="fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[86vw] animate-drawer-in flex-col bg-surface shadow-overlay focus:outline-none">
          <D.Title className="sr-only">Navigation</D.Title>
          <D.Description className="sr-only">Main navigation</D.Description>
          <div className="flex h-14 items-center justify-between px-4">
            <Logo />
            <button type="button" aria-label="Close navigation" onClick={() => onOpenChange(false)} className="inline-flex size-9 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/[0.06]">
              <X className="size-4" />
            </button>
          </div>
          <div className="px-3 pb-2">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onSearch();
              }}
              className="flex h-10 w-full items-center gap-2 rounded-xl bg-ink/[0.05] px-3 text-sm text-ink-3"
            >
              <Search className="size-4" aria-hidden /> Search tools
            </button>
          </div>
          <nav aria-label="Main" className="scroll-thin flex-1 overflow-y-auto px-3 py-1">
            <ul className="space-y-0.5">
              {NAV.map(({ href, label, icon: I }) => {
                const active = isActive(pathname, href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={() => onOpenChange(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn("flex h-11 items-center gap-3 rounded-xl px-3 text-[15px]", active ? "bg-accent/[0.1] font-medium text-accent" : "text-ink hover:bg-ink/[0.04]")}
                    >
                      <I className={cn("size-[18px]", active ? "text-accent" : "text-ink-3")} strokeWidth={1.75} aria-hidden />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="border-t px-3 py-3">
            <Link href="/privacy" onClick={() => onOpenChange(false)} className="flex h-10 items-center gap-3 rounded-xl px-3 text-sm text-ink-2 hover:bg-ink/[0.04]">
              <Shield className="size-4 text-ink-3" strokeWidth={1.75} aria-hidden /> Privacy & Security
            </Link>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
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
  const fullBleed = pathname.startsWith("/editor") || pathname.startsWith("/scan") || pathname === "/tools/sign" || pathname === "/tools/edit";

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
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-raised">
        Skip to content
      </a>
      <TopNav onSearch={() => setPalette(true)} onMenu={() => setDrawer(true)} />
      <Drawer open={drawer} onOpenChange={setDrawer} onSearch={() => setPalette(true)} />
      <main id="main" className={cn("min-w-0 pt-14", fullBleed && "flex flex-col")}>
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
