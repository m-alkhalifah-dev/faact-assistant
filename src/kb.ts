import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const KB_DIR = join(HERE, "..", "knowledge-base");

export interface KBMeta {
  version: string;
  approved: boolean;
  status: string;
  fencedTopics: string[];
  [key: string]: unknown;
}

export interface KBSection {
  heading: string;
  body: string;
}

export interface KnowledgeBase {
  /** The full corpus text injected into the prompt (HTML comments stripped). */
  text: string;
  meta: KBMeta;
  /** Parsed `##` sections — used by the offline mock's keyword search, not by real models. */
  sections: KBSection[];
}

let cached: KnowledgeBase | null = null;

function parseSections(markdown: string): KBSection[] {
  const sections: KBSection[] = [];
  let current: KBSection | null = null;
  for (const line of markdown.split("\n")) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { heading: m[1]!.trim(), body: "" };
    } else if (current) {
      current.body += line + "\n";
    }
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ heading: s.heading, body: s.body.trim() }));
}

export function loadKB(): KnowledgeBase {
  if (cached) return cached;
  const raw = readFileSync(join(KB_DIR, "faact.kb.md"), "utf8");
  const meta = JSON.parse(readFileSync(join(KB_DIR, "meta.json"), "utf8")) as KBMeta;
  // Strip the HTML-comment banner so internal notes never reach the model.
  const text = raw.replace(/<!--[\s\S]*?-->/g, "").trim();
  cached = { text, meta, sections: parseSections(text) };
  return cached;
}
