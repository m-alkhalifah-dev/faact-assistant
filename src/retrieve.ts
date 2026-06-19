import type { Lang } from "./types.ts";
import { loadKB } from "./kb.ts";

/**
 * THE retrieval seam. Everything upstream (prompt builder, LLM call, widget)
 * depends only on this signature — `(query, lang) => context string`.
 *
 * v1 (now): FULL-CONTEXT. The approved corpus is tiny (~a few k tokens) relative
 * to a Flash-class ~1M-token window, so we return the whole KB. This is MORE
 * truthful than vector RAG (retrieval cannot silently drop the decisive passage)
 * and removes the embedding pipeline + vector store entirely.
 *
 * v2 (later, if the KB outgrows ~40–50% of the context budget): replace ONLY this
 * function body with embed(query) -> top-k cosine -> join(chunks). No other code
 * changes. See the `rag-knowledge-base` skill §2.
 */
export function retrieveContext(_query: string, _lang: Lang): string {
  return loadKB().text;
}
