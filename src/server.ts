import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ChatMessage } from "./types.ts";
import { answer } from "./chat.ts";
import { getProviderChain, chainIsMock } from "./config.ts";
import { loadKB } from "./kb.ts";
import { isAllowedOrigin, PREVIEW_HOST_SUFFIX } from "./cors.ts";

/**
 * The HTTP front door for the assistant — the ONLY new surface the deployed host
 * exposes. Zero runtime dependencies on purpose (node:http), so the "swap host"
 * promise stays a config move, not a rewrite. TLS/HTTPS is terminated by the host
 * (Render) in front of this plain-HTTP listener.
 *
 *   GET  /health  → liveness + provider/KB mode (no LLM call) — used by keep-warm + the iPhone test.
 *   POST /chat    → { question, history? } → answer() → grounded reply. CORS-locked + rate-limited.
 *
 * Everything below is config-driven via env so nothing here is host-specific.
 */

// ── Config (all env-driven, safe defaults) ───────────────────────────────────
const PORT = Number(process.env.PORT) || 8787;

// CORS allow-list: the production origin (exact). Comma-separated, overridable
// per host. Netlify deploy-preview / branch origins are matched separately by a
// precise host-suffix rule in isAllowedOrigin (see ./cors.ts) — not enumerated here.
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? "https://faact-academy.netlify.app")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// Basic fixed-window rate limit, per client IP. In-memory → resets on restart and
// is per-instance (fine for one free Render instance; documented in the runbook).
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 20;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;

// Reject oversized bodies before we read them into memory.
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES) || 16 * 1024;
// Cap conversation history we accept from the client (defence-in-depth on tokens).
const MAX_HISTORY_TURNS = Number(process.env.MAX_HISTORY_TURNS) || 12;
const MAX_QUESTION_CHARS = Number(process.env.MAX_QUESTION_CHARS) || 2000;

const STARTED_AT = Date.now();

// ── Rate limiter ─────────────────────────────────────────────────────────────
interface Window {
  count: number;
  resetAt: number;
}
const hits = new Map<string, Window>();

function rateLimit(ip: string): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const w = hits.get(ip);
  if (!w || now >= w.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true, retryAfterMs: 0 };
  }
  w.count += 1;
  if (w.count > RATE_LIMIT_MAX) return { ok: false, retryAfterMs: w.resetAt - now };
  return { ok: true, retryAfterMs: 0 };
}

// Opportunistic cleanup so the Map can't grow unbounded over a long uptime.
setInterval(() => {
  const now = Date.now();
  for (const [ip, w] of hits) if (now >= w.resetAt) hits.delete(ip);
}, RATE_LIMIT_WINDOW_MS).unref();

function clientIp(req: IncomingMessage): string {
  // Behind Render's proxy the real client is the FIRST hop of x-forwarded-for.
  const xff = req.headers["x-forwarded-for"];
  const fwd = Array.isArray(xff) ? xff[0] : xff;
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}

// ── CORS ─────────────────────────────────────────────────────────────────────
/**
 * Apply CORS for an allowed Origin. Returns:
 *  - "allowed"     : Origin is on the allow-list → ACAO set, proceed.
 *  - "no-origin"   : no Origin header (curl / server-side / keep-warm) → proceed, no ACAO.
 *  - "forbidden"   : Origin present but NOT allowed → caller must 403, no ACAO echoed.
 */
function applyCors(req: IncomingMessage, res: ServerResponse): "allowed" | "no-origin" | "forbidden" {
  const origin = req.headers.origin;
  if (!origin) return "no-origin";
  if (!isAllowedOrigin(origin, ALLOWED_ORIGINS)) return "forbidden";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  return "allowed";
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function providerMode(): string {
  const chain = getProviderChain();
  return chainIsMock(chain) ? "mock" : chain.map((p) => p.name).join(",");
}

function sanitizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw.slice(-MAX_HISTORY_TURNS)) {
    if (item && typeof item === "object") {
      const role = (item as Record<string, unknown>).role;
      const content = (item as Record<string, unknown>).content;
      if ((role === "user" || role === "assistant") && typeof content === "string") {
        out.push({ role, content: content.slice(0, MAX_QUESTION_CHARS) });
      }
    }
  }
  return out;
}

// ── Routes ───────────────────────────────────────────────────────────────────
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const cors = applyCors(req, res);

  // Preflight: honour only allowed origins.
  if (req.method === "OPTIONS") {
    if (cors === "forbidden") return sendJson(res, 403, { error: "origin not allowed" });
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /health — cheap liveness, no LLM call. Open to any origin (no secrets here).
  if (path === "/health" && req.method === "GET") {
    const kb = loadKB();
    return sendJson(res, 200, {
      status: "ok",
      service: "faact-assistant",
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
      providerMode: providerMode(),
      kbVersion: kb.meta.version,
      kbApproved: kb.meta.approved,
      time: new Date().toISOString(),
    });
  }

  // POST /chat — the assistant. CORS-locked + rate-limited.
  if (path === "/chat" && req.method === "POST") {
    if (cors === "forbidden") return sendJson(res, 403, { error: "origin not allowed" });

    const ip = clientIp(req);
    const rl = rateLimit(ip);
    if (!rl.ok) {
      res.setHeader("Retry-After", String(Math.ceil(rl.retryAfterMs / 1000)));
      return sendJson(res, 429, { error: "rate limit exceeded, slow down" });
    }

    let bodyText: string;
    try {
      bodyText = await readBody(req);
    } catch {
      return sendJson(res, 413, { error: "request body too large" });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText || "{}");
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }

    const obj = (parsed ?? {}) as Record<string, unknown>;
    const question = typeof obj.question === "string" ? obj.question.trim() : "";
    if (!question) return sendJson(res, 400, { error: "missing 'question' (string)" });
    if (question.length > MAX_QUESTION_CHARS) {
      return sendJson(res, 400, { error: `'question' exceeds ${MAX_QUESTION_CHARS} chars` });
    }
    const history = sanitizeHistory(obj.history);

    try {
      const result = await answer(question, history);
      return sendJson(res, 200, {
        text: result.text,
        provider: result.provider,
        failovers: result.failovers,
        degraded: result.degraded,
      });
    } catch (err) {
      // answer() is designed never to throw; this is pure defence-in-depth.
      console.error(`[server] unexpected error: ${err instanceof Error ? err.message : err}`);
      return sendJson(res, 500, { error: "internal error" });
    }
  }

  // Known paths with the wrong method → 405; everything else → 404.
  if (path === "/health" || path === "/chat") {
    return sendJson(res, 405, { error: "method not allowed" });
  }
  return sendJson(res, 404, { error: "not found" });
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(`[server] handler crash: ${err instanceof Error ? err.message : err}`);
    if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
  });
});

server.listen(PORT, () => {
  console.log(`[server] faact-assistant listening on :${PORT}`);
  console.log(`[server] provider mode: ${providerMode()}`);
  console.log(`[server] allowed origins: ${[...ALLOWED_ORIGINS].join(", ")} (+ *${PREVIEW_HOST_SUFFIX})`);
  console.log(`[server] rate limit: ${RATE_LIMIT_MAX} req / ${RATE_LIMIT_WINDOW_MS}ms per IP`);
});
