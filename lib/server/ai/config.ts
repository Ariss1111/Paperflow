import "server-only";

// Everything that decides which AI runs and how much of it a visitor may use. All of it comes from the
// environment, so a deployment can change provider, model or limits without touching code.

const int = (name: string, d: number) => {
  const raw = process.env[name]?.trim();
  // unset or blank means "use the default", never 0
  if (!raw) return d;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : d;
};

export type ProviderId = "anthropic" | "none";

export function providerId(): ProviderId {
  const p = (process.env.AI_PROVIDER || "anthropic").toLowerCase();
  return p === "none" || p === "off" ? "none" : "anthropic";
}

export const AI_MODEL = process.env.AI_MODEL || "claude-opus-5-5";

/** What one visitor may do with AI. "pro" is ready for a paid plan; until billing exists, everyone is on "free". */
export interface AiPlan {
  id: "free" | "pro";
  label: string;
  /** AI requests per visitor per day (a long document split into sections counts once) */
  dailyRequests: number;
  /** tokens (sent + received) per visitor per day */
  dailyTokens: number;
  /** biggest file the AI will take */
  maxFileBytes: number;
  /** longest document the AI will take */
  maxPages: number;
}

export function plans(): Record<AiPlan["id"], AiPlan> {
  return {
    free: {
      id: "free",
      label: "Free",
      dailyRequests: int("AI_DAILY_REQUESTS", 30),
      dailyTokens: int("AI_DAILY_TOKENS", 1_500_000),
      maxFileBytes: int("AI_MAX_FILE_MB", 25) * 1024 * 1024,
      maxPages: int("AI_MAX_PAGES", 300),
    },
    pro: {
      id: "pro",
      label: "Pro",
      dailyRequests: int("AI_PRO_DAILY_REQUESTS", 300),
      dailyTokens: int("AI_PRO_DAILY_TOKENS", 15_000_000),
      maxFileBytes: int("AI_PRO_MAX_FILE_MB", 30) * 1024 * 1024,
      maxPages: int("AI_PRO_MAX_PAGES", 1000),
    },
  };
}

/** The plan a session is on. The single place a billing system would plug in. */
export function planFor(_sid: string): AiPlan {
  return plans().free;
}

/** Shared ceiling for the whole server per day, protecting the AI bill from abuse across many sessions. */
export const globalDailyRequests = () => int("AI_GLOBAL_DAILY_REQUESTS", 2000);
export const perMinute = () => int("RATE_LIMIT_AI_PER_MIN", 12);

// How documents are cut up. The API reads up to 100 PDF pages and 32 MB per request.
export const NATIVE_MAX_PAGES = 100;
export const NATIVE_MAX_BYTES = 30 * 1024 * 1024;
/** pages per section when a document is too long to read in one request */
export const SECTION_PAGES = 50;
/** pages per section when translating: the translation of each must fit in one answer */
export const TRANSLATE_PAGES = 8;
/** characters of extracted text sent per section in text mode */
export const SECTION_CHARS = 120_000;
