export type Lang = "ar" | "en";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** One OpenAI-compatible provider. Swapping providers = changing this object. */
export interface ProviderConfig {
  name: string;
  /** OpenAI-compatible base, e.g. https://generativelanguage.googleapis.com/v1beta/openai */
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface GenerationSettings {
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  retriesPerProvider: number;
}

export interface LLMResult {
  /** The answer text shown to the visitor. */
  text: string;
  /** Which provider actually served the answer ("mock" in $0 demo mode). */
  provider: string;
  /** How many providers we had to skip before one worked. */
  failovers: number;
  /** True when every provider failed and we fell back to the human-handoff message. */
  degraded: boolean;
}
