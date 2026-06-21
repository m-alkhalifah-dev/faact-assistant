import { isAllowedOrigin } from "../src/cors.ts";

/**
 * Proves the CORS origin matcher: exact production origin + precise Netlify
 * preview suffix, with naive-substring lookalikes rejected. Run:
 *   node scripts/cors-origin-test.ts
 */
const PROD = new Set(["https://faact-academy.netlify.app"]);

const cases: { origin: string; expect: boolean; note: string }[] = [
  { origin: "https://faact-academy.netlify.app", expect: true, note: "production origin (exact match)" },
  { origin: "https://deploy-preview-7--faact-academy.netlify.app", expect: true, note: "real deploy-preview (suffix match)" },
  { origin: "https://evil--faact-academy.netlify.app.attacker.com", expect: false, note: "lookalike: suffix mid-host, real host is attacker.com" },
  { origin: "https://faact-academy.netlify.app.evil.com", expect: false, note: "lookalike: prod host is a prefix of evil.com" },
  { origin: "http://deploy-preview-7--faact-academy.netlify.app", expect: false, note: "preview over http (not https)" },
];

let failed = 0;
for (const c of cases) {
  const got = isAllowedOrigin(c.origin, PROD);
  const ok = got === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${got ? "ALLOW" : "BLOCK"}  ${c.origin}\n        ${c.note}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
