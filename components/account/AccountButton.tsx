"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { FolderOpen, LogOut, UserRound } from "lucide-react";
import { initials, signOut, useAccount } from "@/lib/client/account";
import { toast } from "@/components/ui/feedback";

const ITEM = "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink outline-none data-[highlighted]:bg-accent data-[highlighted]:text-white";

export function Avatar({ name, email, size = 30 }: { name: string; email: string; size?: number }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-[#5b4cf0] font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials({ name, email })}
    </span>
  );
}

/** "Sign in" when signed out; the account menu when signed in. */
export function AccountButton() {
  const { loaded, user } = useAccount();
  const router = useRouter();
  if (!loaded) return <span className="size-[30px]" aria-hidden />;
  if (!user)
    return (
      <Link href="/signin" className="inline-flex h-9 shrink-0 items-center rounded-full bg-accent px-3.5 text-[13.5px] font-medium text-white shadow-sm transition-colors hover:bg-accent/90">
        Sign in
      </Link>
    );
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={`Account: ${user.email}`} className="rounded-full outline-offset-2">
        <Avatar name={user.name} email={user.email} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={8} className="glass z-50 w-64 animate-rise-in rounded-xl p-1.5 shadow-overlay">
          <div className="px-2.5 pb-2 pt-1.5">
            <p className="truncate text-sm font-semibold text-ink">{user.name || "Your account"}</p>
            <p className="truncate text-xs text-ink-3">{user.email}</p>
          </div>
          <Menu.Separator className="my-1 h-px bg-ink/10" />
          <Menu.Item className={ITEM} onSelect={() => router.push("/files")}>
            <FolderOpen className="size-4 opacity-70" /> My Documents
          </Menu.Item>
          <Menu.Item className={ITEM} onSelect={() => router.push("/account")}>
            <UserRound className="size-4 opacity-70" /> Account
          </Menu.Item>
          <Menu.Separator className="my-1 h-px bg-ink/10" />
          <Menu.Item
            className={ITEM}
            onSelect={async () => {
              await signOut().catch(() => undefined);
              toast("Signed out.", "success");
              router.push("/");
              router.refresh();
            }}
          >
            <LogOut className="size-4 opacity-70" /> Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
