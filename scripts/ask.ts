import { answer } from "../src/chat.ts";
import { getProviderChain, chainIsMock } from "../src/config.ts";

/** One-shot: `npm run ask -- "your question"` — prints the answer + which provider served. */
const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('Usage: npm run ask -- "your question"');
  process.exit(1);
}

const chain = getProviderChain();
const mode = chainIsMock(chain) ? "MOCK ($0, offline)" : chain.map((p) => p.name).join(" → ");
console.error(`[provider chain] ${mode}\n`);

const result = await answer(question);
console.log(result.text);
console.error(
  `\n[meta] provider=${result.provider} failovers=${result.failovers} degraded=${result.degraded}`,
);
