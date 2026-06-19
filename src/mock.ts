import type { ChatMessage } from "./types.ts";
import { detectLang, DEFERRAL } from "./lang.ts";
import { loadKB } from "./kb.ts";

/**
 * Deterministic, offline, $0 stand-in for a real LLM.
 *
 * It is NOT a language model. It implements the grounding RULES by hand so the
 * whole machine (retrieve -> prompt -> provider -> answer -> eval gate) can be
 * demonstrated with no API key and no cost. It:
 *   - DEFERS on fenced/danger topics (price, date, discount, seats, ISO, PMI-ATP),
 *   - answers in-KB questions by returning the most relevant KB section,
 *   - defers when nothing matches.
 *
 * The REAL truthfulness proof is `npm run eval` against a real model (free Gemini).
 * The mock proves the plumbing and the gate; the model proves the behavior.
 */

const DANGER: RegExp[] = [
  // prices / fees
  /price|cost|fee|tuition|how much|سعر|أسعار|تكلفة|التكلفة|رسوم|كم يكلف|بكم|كم سعر/i,
  // discounts
  /discount|promo|coupon|خصم|كوبون|عرض|تخفيض/i,
  // dates / intake
  /start date|starting date|when (does|do|is|will|can).*(start|begin|join)|next (intake|cohort|batch|term)|متى يبدأ|متى تبدأ|تاريخ البدء|موعد البدء|الدفعة القادمة|الدفعه القادمه|متى الدبلوم/i,
  // seats / deadlines / registration
  /seats?\b|availab|deadline|register by|مقاعد|آخر موعد|موعد التسجيل|هل يوجد مقاعد/i,
  // ISO / unlisted accreditation traps
  /\biso\b|أيزو|الأيزو/i,
  // PMI ATP status
  /\batp\b|authorized training partner|شريك تدريب معتمد|معتمدين من pmi|اعتماد pmi/i,
];

const INJECTION: RegExp[] = [
  /ignore (your |the |all |previous |above )*instructions/i,
  /disregard (your|the|all|previous|above)/i,
  /system prompt|reveal.*(prompt|instructions)|show me your (prompt|rules)/i,
  /تجاهل.*(التعليمات|تعليمات)|اكشف.*(التعليمات|البرومبت)|تظاهر/i,
];

const ARABIC = /[؀-ۿ]/;

/** Function words + brand name: no retrieval signal, so they don't score. */
const STOP = new Set<string>([
  // brand
  "faact", "academy",
  // english function words (≥3 chars; shorter ones are already filtered out)
  "the", "are", "was", "were", "has", "have", "had", "does", "did", "can", "could",
  "will", "would", "what", "when", "where", "who", "whom", "how", "why", "which",
  "your", "you", "our", "with", "for", "and", "from", "about", "this", "that",
  "these", "those", "any", "all", "give", "get", "tell", "please", "there",
  // arabic function words
  "اكاديميه", "اين", "ماذا", "كيف", "هذا", "هذه", "التي", "الذي", "لدي", "عند", "مع", "هل",
]);

/**
 * Normalize for matching: lowercase, strip tashkeel + combining hamza, then unify
 * hamza/alef/ya/ta-marbuta. Stripping the combining mark BEFORE mapping precomposed
 * letters makes "مؤسس" match whether stored precomposed (U+0624) or decomposed
 * (و + U+0654) — otherwise "founder" silently fails to match.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ٰ]/g, "") // tashkeel + combining hamza
    .replace(/[أإآ]/g, "ا") // أ إ آ -> ا
    .replace(/ؤ/g, "و") // ؤ -> و
    .replace(/ئ/g, "ي") // ئ -> ي
    .replace(/ء/g, "") // ء -> (remove)
    .replace(/ى/g, "ي") // ى -> ي
    .replace(/ة/g, "ه"); // ة -> ه
}

/** Drop the Arabic definite article "ال" so "الأكاديمية" matches "أكاديمية". */
function stem(token: string): string {
  return ARABIC.test(token) && token.startsWith("ال") && token.length > 4
    ? token.slice(2)
    : token;
}

function tokenize(s: string): string[] {
  return normalize(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3)
    .map(stem);
}

const occurrences = (hay: string, needle: string): number =>
  needle ? hay.split(needle).length - 1 : 0;

interface Doc {
  raw: string;
  body: string; // normalized full text (for English substring matching)
  headStems: Set<string>;
  bodyStems: string[];
}

/**
 * Pick the most relevant KB section by TF-IDF, so a ubiquitous word ("academy /
 * الأكاديمية") can't drown out the discriminating one ("founder / مؤسس").
 *
 * - Arabic terms match WHOLE WORDS (stemmed) so "مؤسس" (founder) doesn't collide
 *   with "مؤسسات" (institutions).
 * - English terms match as substrings so "accredit" still hits "accreditors".
 * - idf = log(N/df) zeroes terms present everywhere; presence-based tf means the
 *   rarer, more discriminating term decides the match. Heading hits get a bonus.
 * - The "NOT available" fence list is never an answer source.
 */
function bestSection(question: string): string | null {
  const { sections } = loadKB();
  const candidates = sections.filter((s) => !/not available|غير متوفر/i.test(s.heading));
  if (candidates.length === 0) return null;

  // Function words + the brand name carry no retrieval signal (they appear in most
  // questions and many sections) — drop them, unless they're all the visitor typed.
  const all = [...new Set(tokenize(question))];
  const meaningful = all.filter((t) => !STOP.has(t));
  const qTokens = meaningful.length > 0 ? meaningful : all;
  if (qTokens.length === 0) return null;

  const N = candidates.length;
  const docs: Doc[] = candidates.map((s) => ({
    raw: s.body,
    body: normalize(s.heading + "\n" + s.body),
    headStems: new Set(tokenize(s.heading)),
    bodyStems: tokenize(s.heading + "\n" + s.body),
  }));

  const present = (d: Doc, t: string): boolean =>
    ARABIC.test(t) ? d.bodyStems.includes(t) : d.body.includes(t);
  const inHeading = (d: Doc, t: string): boolean =>
    ARABIC.test(t) ? d.headStems.has(t) : occurrences(d.body, t) > 0 && d.body.split("\n")[0]!.includes(t);

  let best: { score: number; body: string } | null = null;
  for (const d of docs) {
    let score = 0;
    for (const t of qTokens) {
      const df = docs.filter((x) => present(x, t)).length;
      if (df === 0 || !present(d, t)) continue;
      const idf = Math.log(N / df); // 0 when the term is in every section
      score += (1 + (inHeading(d, t) ? 3 : 0)) * idf;
    }
    if (score > 0 && (!best || score > best.score)) best = { score, body: d.raw };
  }
  return best ? best.body : null;
}

export function mockComplete(messages: ChatMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const q = lastUser?.content ?? "";
  const lang = detectLang(q);

  if (INJECTION.some((re) => re.test(q))) return DEFERRAL[lang];
  if (DANGER.some((re) => re.test(q))) return DEFERRAL[lang];

  const section = bestSection(q);
  return section ?? DEFERRAL[lang];
}
