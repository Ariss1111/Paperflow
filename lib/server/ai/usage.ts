import "server-only";
import fs from "node:fs";
import path from "node:path";
import { env } from "../env";
import { UserError } from "../errors";
import { globalDailyRequests, planFor, type AiPlan } from "./config";

// Per-visitor daily AI usage, kept in memory and written to the data directory so a restart
// doesn't hand everyone a fresh allowance. Counters reset at midnight UTC.

interface Counter {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

interface State {
  day: string;
  sessions: Record<string, Counter>;
  total: number;
}

const today = () => new Date().toISOString().slice(0, 10);
const file = () => path.join(env.dataDir, "ai-usage.json");
let state: State | null = null;
let saveTimer: NodeJS.Timeout | null = null;

function load(): State {
  if (state && state.day === today()) return state;
  if (!state) {
    try {
      const saved = JSON.parse(fs.readFileSync(file(), "utf8")) as State;
      if (saved.day === today()) return (state = saved);
    } catch {
      // first run or unreadable: start fresh
    }
  }
  return (state = { day: today(), sessions: {}, total: 0 });
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(env.dataDir, { recursive: true });
      fs.writeFileSync(file(), JSON.stringify(state));
    } catch {
      // usage still counts in memory
    }
  }, 500);
  saveTimer.unref?.();
}

const counter = (sid: string) => (load().sessions[sid] ??= { requests: 0, inputTokens: 0, outputTokens: 0 });

function resetsAt(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

export interface UsageReport {
  plan: Pick<AiPlan, "id" | "label" | "dailyRequests" | "dailyTokens" | "maxFileBytes" | "maxPages">;
  requests: number;
  tokens: number;
  resetsAt: string;
}

export function usageFor(sid: string): UsageReport {
  const c = counter(sid);
  const p = planFor(sid);
  return {
    plan: { id: p.id, label: p.label, dailyRequests: p.dailyRequests, dailyTokens: p.dailyTokens, maxFileBytes: p.maxFileBytes, maxPages: p.maxPages },
    requests: c.requests,
    tokens: c.inputTokens + c.outputTokens,
    resetsAt: resetsAt(),
  };
}

/** Counts one AI request against the visitor's and the server's allowance, or refuses it. */
export function reserveRequest(sid: string) {
  const p = planFor(sid);
  const c = counter(sid);
  const s = load();
  const when = new Date(resetsAt()).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  if (c.requests >= p.dailyRequests) throw new UserError(`You've used all ${p.dailyRequests} AI requests for today. They reset at ${when} UTC.`, "ai_quota", 429);
  if (c.inputTokens + c.outputTokens >= p.dailyTokens) throw new UserError(`You've reached today's AI reading allowance. It resets at ${when} UTC.`, "ai_quota", 429);
  if (s.total >= globalDailyRequests()) throw new UserError("The AI tools have reached this server's limit for today. Please try again tomorrow.", "ai_quota_global", 429);
  c.requests++;
  s.total++;
  save();
}

/** Adds the tokens a call actually used (as reported by the provider). */
export function recordTokens(sid: string, input: number, output: number) {
  const c = counter(sid);
  c.inputTokens += Math.max(0, input);
  c.outputTokens += Math.max(0, output);
  save();
}

/** Token allowance left, so a long multi-section job can stop cleanly instead of overspending. */
export function tokensLeft(sid: string): number {
  const c = counter(sid);
  return planFor(sid).dailyTokens - c.inputTokens - c.outputTokens;
}

/** Test hook. */
export function resetUsage() {
  state = { day: today(), sessions: {}, total: 0 };
}
