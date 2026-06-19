import type { ChatMessage, LLMResult } from "./types.ts";
import { detectLang } from "./lang.ts";
import { buildMessages } from "./prompt.ts";
import { getProviderChain, getSettings } from "./config.ts";
import { callLLM } from "./providers.ts";

/**
 * The one entry point the rest of the system (CLI, eval, future HTTP server) uses.
 *   question -> retrieveContext -> grounded prompt -> failover LLM call -> answer
 */
export async function answer(question: string, history: ChatMessage[] = []): Promise<LLMResult> {
  const lang = detectLang(question);
  const messages = buildMessages(question, lang, history);
  const chain = getProviderChain();
  const settings = getSettings();
  return callLLM(messages, chain, settings, lang);
}
