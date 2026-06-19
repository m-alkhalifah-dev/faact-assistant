import type { ProviderConfig } from "../src/types.ts";
import { buildMessages } from "../src/prompt.ts";
import { getSettings } from "../src/config.ts";
import { callLLM } from "../src/providers.ts";

/**
 * Proves the resilience contract WITHOUT any API key, using two offline stand-ins:
 *   mock://429   — always returns a (simulated) 429 rate-limit
 *   mock://local — the deterministic grounded mock
 *
 * 1. [429 -> mock]  : primary rate-limits, chain advances, visitor still gets an answer.
 * 2. [429]          : everything down -> graceful bilingual human-handoff, never a crash.
 */

const sim429: ProviderConfig = { name: "sim-429", baseURL: "mock://429", apiKey: "x", model: "x" };
const okMock: ProviderConfig = { name: "mock", baseURL: "mock://local", apiKey: "", model: "x" };

const settings = { ...getSettings(), retriesPerProvider: 1 }; // keep the demo quick
const messages = buildMessages("ما هي الدبلومات المتاحة؟", "ar");

console.log("── Scenario 1: primary 429 → fallback answers ──────────────────────");
const r1 = await callLLM(messages, [sim429, okMock], settings, "ar");
console.log(`provider=${r1.provider}  failovers=${r1.failovers}  degraded=${r1.degraded}`);
console.log(`answer: ${r1.text.slice(0, 90)}...`);
const pass1 = r1.provider === "mock" && r1.failovers === 1 && !r1.degraded;
console.log(pass1 ? "✅ PASS — failed over to the backup provider\n" : "❌ FAIL\n");

console.log("── Scenario 2: all providers down → graceful human handoff ─────────");
const r2 = await callLLM(messages, [sim429], settings, "ar");
console.log(`provider=${r2.provider}  failovers=${r2.failovers}  degraded=${r2.degraded}`);
console.log(`answer: ${r2.text}`);
const pass2 = r2.degraded && r2.provider === "none" && /واتساب/.test(r2.text);
console.log(pass2 ? "✅ PASS — degraded to bilingual handoff, no crash\n" : "❌ FAIL\n");

process.exit(pass1 && pass2 ? 0 : 1);
