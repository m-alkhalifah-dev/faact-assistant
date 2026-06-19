import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { ChatMessage } from "./types.ts";
import { answer } from "./chat.ts";
import { getProviderChain, chainIsMock } from "./config.ts";
import { loadKB } from "./kb.ts";

const kb = loadKB();
const chain = getProviderChain();
const mode = chainIsMock(chain) ? "MOCK ($0, offline)" : chain.map((p) => p.name).join(" → ");

console.log("FAACT Assistant — interactive CLI");
console.log(`KB: v${kb.meta.version}  approved=${kb.meta.approved}`);
console.log(`Providers: ${mode}`);
console.log('Type a question (Arabic or English). Type "exit" to quit.\n');

const rl = createInterface({ input: stdin, output: stdout });
const history: ChatMessage[] = [];

while (true) {
  const q = (await rl.question("you › ")).trim();
  if (!q) continue;
  if (q === "exit" || q === "quit" || q === "خروج") break;

  const result = await answer(q, history);
  console.log(`\nbot › ${result.text}`);
  console.log(`      [${result.provider}${result.degraded ? " · DEGRADED" : ""}]\n`);

  history.push({ role: "user", content: q });
  history.push({ role: "assistant", content: result.text });
}

rl.close();
