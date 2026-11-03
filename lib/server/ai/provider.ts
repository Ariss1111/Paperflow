import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, providerId, type ProviderId } from "./config";

// The AI provider behind Pagelyt's AI tools. Tasks describe *what* to send (document parts, the
// conversation, an optional JSON schema); a provider turns that into API calls. To add another
// provider, implement AiProvider and register it in PROVIDERS.

export type DocPart =
  | { type: "pdf"; data: Uint8Array; title: string }
  | { type: "image"; data: Uint8Array; mime: "image/jpeg" | "image/png" | "image/gif" | "image/webp" }
  | { type: "text"; text: string };

export interface AiCall {
  system: string;
  /** the document (or a section of it), sent with the first user turn */
  parts: DocPart[];
  /** the conversation; the last turn is the user's request */
  turns: { role: "user" | "assistant"; content: string }[];
  effort: "low" | "medium" | "high";
  maxTokens: number;
  /** when set, the answer is JSON matching this schema */
  schema?: Record<string, unknown>;
  /** cache the document prefix so follow-up calls on the same document are cheaper */
  cache?: boolean;
}

export type CallEvent =
  | { t: "text"; v: string }
  | { t: "end"; stop: string | null; model: string; inputTokens: number; outputTokens: number };

export interface AiProvider {
  id: ProviderId;
  /** shown to users when explaining where their document goes */
  label: string;
  configured(): boolean;
  call(c: AiCall, signal: AbortSignal): AsyncGenerator<CallEvent>;
  describeError(e: unknown): string;
}

// ------------------------------------------------------------------ Anthropic (Claude)

let client: Anthropic | null = null;

const anthropic: AiProvider = {
  id: "anthropic",
  label: "Anthropic (Claude)",
  configured: () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  async *call(c, signal) {
    // reads ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL from the environment
    client ??= new Anthropic();
    const blocks: Anthropic.Beta.BetaContentBlockParam[] = c.parts.map((p, i) => {
      // the cache breakpoint goes on the last document block, so the whole document is the cached prefix
      const cache = c.cache !== false && i === c.parts.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {};
      if (p.type === "pdf") return { type: "document", title: p.title, source: { type: "base64", media_type: "application/pdf", data: Buffer.from(p.data).toString("base64") }, ...cache };
      if (p.type === "image") return { type: "image", source: { type: "base64", media_type: p.mime, data: Buffer.from(p.data).toString("base64") }, ...cache };
      return { type: "text", text: p.text, ...cache };
    });
    const messages: Anthropic.Beta.BetaMessageParam[] = c.turns.map((t, i) =>
      i === 0 ? { role: "user", content: [...blocks, { type: "text", text: t.content }] } : { role: t.role, content: t.content },
    );
    const stream = client.beta.messages.stream(
      {
        model: AI_MODEL,
        max_tokens: c.maxTokens,
        system: [{ type: "text", text: c.system }],
        messages,
        output_config: { effort: c.effort, ...(c.schema ? { format: { type: "json_schema", schema: c.schema } } : {}) },
        // if the model declines, Anthropic re-runs the request on a suitable fallback model instead of failing
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield { t: "text", v: event.delta.text };
    }
    const final = await stream.finalMessage();
    const u = final.usage;
    yield {
      t: "end",
      stop: final.stop_reason ?? null,
      model: final.model,
      // cached reads still count as tokens sent; they're just cheaper
      inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
    };
  },
  describeError(e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "The AI service rejected this server's API key. The administrator needs to check ANTHROPIC_API_KEY.";
    if (e instanceof Anthropic.RateLimitError) return "The AI service is busy right now. Wait a moment and try again.";
    if (e instanceof Anthropic.BadRequestError) return `The AI couldn't process this document: ${e.message.replace(/^\d+\s*/, "").slice(0, 300)}`;
    if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach the AI service. Check the server's internet connection and try again.";
    if (e instanceof Anthropic.APIError) return "The AI service had a problem. Please try again in a moment.";
    return "Something went wrong while talking to the AI. Please try again.";
  },
};

const PROVIDERS: Partial<Record<ProviderId, AiProvider>> = { anthropic };

/** The configured provider, or null when AI is switched off or has no credentials. */
export function provider(): AiProvider | null {
  const p = PROVIDERS[providerId()];
  return p && p.configured() ? p : null;
}

/** For messages: the provider that *would* be used, configured or not. */
export function providerLabel(): string | null {
  return PROVIDERS[providerId()]?.label ?? null;
}
