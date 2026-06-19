import type { Lang } from "./types.ts";

const ARABIC = /[؀-ۿ]/;

/** Detect language from the text; defaults to Arabic (the RTL-primary audience). */
export function detectLang(text: string): Lang {
  return ARABIC.test(text) ? "ar" : "en";
}

/** The approved deferral / human-handoff wording (gate D-3 defaults). */
export const DEFERRAL: Record<Lang, string> = {
  ar: "لا تتوفر لديّ هذه المعلومة بدقة. تواصل معنا عبر واتساب وسيسعد فريقنا بمساعدتك: https://wa.me/966531401438",
  en: "I don't have that information for certain. Please contact us on WhatsApp and our team will be glad to help: https://wa.me/966531401438",
};

/** Shown only when every provider is down — never a stack trace to the visitor. */
export const SERVICE_DOWN: Record<Lang, string> = {
  ar: "تعذّر الوصول إلى المساعد حاليًا. يُرجى المحاولة بعد قليل أو التواصل معنا عبر واتساب: https://wa.me/966531401438",
  en: "The assistant is unavailable right now. Please try again shortly or contact us on WhatsApp: https://wa.me/966531401438",
};
