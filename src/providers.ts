import type { ChatMessage, GenerationSettings, LLMResult, Lang, ProviderConfig } from "./types.ts";
import { SERVICE_DOWN } from "./lang.ts";
import { mockComplete } from "./mock.ts";

/** How a failed attempt should be handled. */
type FailKind =
  | "transient" // 429 / 5xx / timeout / network → retry, then advance
  | "fatal-provider" // 401 / 403 (dead key) → don't retry; advance to next provider, log loudly
  | "fatal-stop"; // 400 (our bug) → would fail everywhere; stop the chain, log loudly

class ProviderError extends Error {
  kind: FailKind;
  retryAfterMs: number | undefined;
  constructor(kind: FailKind, message: string, retryAfterMs?: number) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface OpenAIChatResponse {
  choices?: { message?: { content?: string } }[];
}

/** One attempt against one provider. Throws ProviderError on failure. */
async function callProvider(
  provider: ProviderConfig,
  messages: ChatMessage[],
  settings: GenerationSettings,
): Promise<string> {
  // Offline stand-ins for the $0 demo and the failover test.
  if (provider.baseURL === "mock://local") return mockComplete(messages);
  if (provider.baseURL === "mock://429") {
    throw new ProviderError("transient", "simulated 429 rate limit", 50);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    const res = await fetch(`${provider.baseURL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        stream: false,
      }),
    });

    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined;
      if (res.status === 429 || res.status === 408 || res.status >= 500) {
        throw new ProviderError("transient", `HTTP ${res.status}`, retryAfterMs);
      }
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError("fatal-provider", `HTTP ${res.status} (bad/dead key)`);
      }
      if (res.status === 400) {
        throw new ProviderError("fatal-stop", `HTTP 400 (malformed request)`);
      }
      throw new ProviderError("transient", `HTTP ${res.status}`);
    }

    const data = (await res.json()) as OpenAIChatResponse;
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new ProviderError("transient", "empty completion");
    return text;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    // AbortError (timeout) or network failure → transient.
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProviderError("transient", `network/timeout: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Walk the provider chain with retry/backoff. Returns the first success, or a
 * graceful bilingual human-handoff message if everything fails. Never throws to
 * the caller — the visitor must never see a stack trace.
 */
export async function callLLM(
  messages: ChatMessage[],
  chain: ProviderConfig[],
  settings: GenerationSettings,
  lang: Lang,
): Promise<LLMResult> {
  let failovers = 0;

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i]!;
    const attempts = settings.retriesPerProvider + 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const text = await callProvider(provider, messages, settings);
        return { text, provider: provider.name, failovers, degraded: false };
      } catch (err) {
        const e = err as ProviderError;

        if (e.kind === "fatal-stop") {
          console.error(`[llm] fatal-stop on ${provider.name}: ${e.message} — aborting chain`);
          return { text: SERVICE_DOWN[lang], provider: "none", failovers, degraded: true };
        }
        if (e.kind === "fatal-provider") {
          console.error(`[llm] ${provider.name} unusable: ${e.message} — advancing`);
          break; // don't retry a dead key; move to next provider
        }
        // transient: backoff then retry, unless this was the last attempt
        const isLast = attempt === attempts - 1;
        console.error(
          `[llm] ${provider.name} transient (${e.message}) attempt ${attempt + 1}/${attempts}`,
        );
        if (!isLast) {
          const backoff = e.retryAfterMs ?? 500 * 2 ** attempt + Math.floor(Math.random() * 250);
          await sleep(backoff);
        }
      }
    }

    // This provider gave up; count a failover if another remains.
    if (i < chain.length - 1) failovers++;
  }

  console.error(`[llm] all providers exhausted — degrading to human handoff`);
  return { text: SERVICE_DOWN[lang], provider: "none", failovers, degraded: true };
}
