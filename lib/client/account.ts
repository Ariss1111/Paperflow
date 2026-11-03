"use client";
import * as React from "react";

// Who is signed in, shared by every component on the page.

export interface User {
  id: string;
  email: string;
  name: string;
  verified: boolean;
  hasPassword: boolean;
  google: boolean;
  prefs: Record<string, unknown>;
  createdAt: number;
}
export interface Features {
  google: boolean;
  email: boolean;
  devMailbox: boolean;
}
interface State {
  loaded: boolean;
  user: User | null;
  features: Features;
}

let state: State = { loaded: false, user: null, features: { google: false, email: false, devMailbox: false } };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function set(s: Partial<State>) {
  state = { ...state, ...s };
  listeners.forEach((l) => l());
}

export function refreshAccount(): Promise<void> {
  inflight ??= fetch("/api/auth/me", { cache: "no-store" })
    .then((r) => r.json())
    .then((d: { user: User | null; features: Features }) => set({ loaded: true, user: d.user, features: d.features }))
    .catch(() => set({ loaded: true }))
    .finally(() => (inflight = null));
  return inflight;
}

export function useAccount() {
  const s = React.useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
  React.useEffect(() => {
    if (!state.loaded) void refreshAccount();
  }, []);
  return s;
}

/** POST/PATCH/DELETE JSON to an account or document API; throws the server's message on failure. */
export async function call<T = Record<string, unknown>>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body !== undefined ? { "content-type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status}).`), { status: res.status, code: (data as { code?: string }).code });
  return data;
}

export async function signOut() {
  await call("/api/auth/logout", "POST", {});
  set({ user: null });
}

/** Saves preferences to the account (merged on the server) so every device gets them. */
export async function savePrefs(prefs: Record<string, unknown>) {
  if (!state.user) return;
  set({ user: { ...state.user, prefs: { ...state.user.prefs, ...prefs } } });
  await call("/api/auth/me", "PATCH", { prefs }).catch(() => undefined);
}

export const initials = (u: Pick<User, "name" | "email">) =>
  (u.name || u.email)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
