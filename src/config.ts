import type { ProviderConfig, GenerationSettings } from "./types.ts";

/**
 * Registry of known OpenAI-compatible providers.
 * Adding a provider is ONE row here — no call-site changes (see llm-provider-failover skill).
 * Every endpoint below speaks the OpenAI /chat/completions shape.
 */
interface RegistryEntry {
  baseURL: string;
  defaultModel: string;
  keyEnv: string;
  modelEnv: string;
}

const REGISTRY: Record<string, RegistryEntry> = {
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash-lite",
    keyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
  },
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    keyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    keyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
  },
  // Self-hosted (e.g. Gemma on the Oracle box): $0 API, no data egress.
  // Local servers usually need no key — included only if OLLAMA_BASE_URL is set.
  ollama: {
    baseURL: "http://localhost:11434/v1",
    defaultModel: "gemma2:9b",
    keyEnv: "OLLAMA_API_KEY",
    modelEnv: "OLLAMA_MODEL",
  },
};

export const MOCK_PROVIDER: ProviderConfig = {
  name: "mock",
  baseURL: "mock://local",
  apiKey: "",
  model: "deterministic-grounded-stub",
};

/**
 * Build the ordered provider chain from env.
 * - LLM_CHAIN="gemini,groq" sets the order.
 * - A provider is included only if its API key is present (or, for ollama, OLLAMA_BASE_URL is set).
 * - If NO real provider is available, returns [mock] so the $0 demo always runs.
 */
export function getProviderChain(): ProviderConfig[] {
  const order = (process.env.LLM_CHAIN ?? "gemini,groq")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const chain: ProviderConfig[] = [];
  for (const name of order) {
    const entry = REGISTRY[name];
    if (!entry) continue;

    const isLocal = name === "ollama";
    const baseURL = isLocal ? (process.env.OLLAMA_BASE_URL ?? entry.baseURL) : entry.baseURL;
    const apiKey = process.env[entry.keyEnv] ?? "";
    const model = process.env[entry.modelEnv] ?? entry.defaultModel;

    // Include hosted providers only with a key; include ollama only if a base URL was set.
    const available = isLocal ? Boolean(process.env.OLLAMA_BASE_URL) : apiKey.length > 0;
    if (available) chain.push({ name, baseURL, apiKey, model });
  }

  return chain.length > 0 ? chain : [MOCK_PROVIDER];
}

export function getSettings(): GenerationSettings {
  const num = (v: string | undefined, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    temperature: num(process.env.LLM_TEMPERATURE, 0.1),
    maxTokens: num(process.env.LLM_MAX_TOKENS, 700),
    timeoutMs: num(process.env.LLM_TIMEOUT_MS, 30000),
    retriesPerProvider: Math.floor(num(process.env.LLM_RETRIES_PER_PROVIDER, 2)),
  };
}

export function chainIsMock(chain: ProviderConfig[]): boolean {
  return chain.length === 1 && chain[0]?.name === "mock";
}
