# FAACT Assistant — backend (Phase 1)

A grounded, refusal-first, **provider-portable** chat backend for FAACT Academy.
Answers **only** from an approved knowledge base; defers to a human (WhatsApp) on
anything it doesn't know. Built as the `rag-knowledge-base` + `llm-provider-failover`
skills prescribe.

> ⚠️ **Status: PLACEHOLDER / DEMO.** The knowledge base is sample content (real
> public facts only, danger topics fenced). It is **not** cleared by gate **D-1**
> (Dr. Fahd approves an AI speaking for FAACT) or **D-2** (approved corpus).
> **Not wired into the live site.** This repo is a runnable demo to help secure those
> approvals. It MAY run as a standalone, always-on **demo backend** (its own URL,
> CORS-locked, nothing on the site links to it) — but going live *on the site* still
> waits on D-1/D-2 and the widget (a later session).

This is the **backend, in its own repo** — the FAACT site never imports it. The site
will only ever know a URL string (added in a later phase, behind an off-by-default flag).

---

## Requirements
- Node **≥ 22.9** (uses native TypeScript type-stripping and `--env-file-if-exists`;
  developed on Node 25). No build step, **zero runtime dependencies**.

## Quickstart — $0, no key (MOCK mode)
```bash
npm run ask -- "ما هي الدبلومات المتاحة؟"
npm run ask -- "How much does the Cybersecurity diploma cost?"   # → defers to WhatsApp
npm run chat        # interactive REPL (Arabic or English)
npm run eval        # the truthfulness gate (see below)
```
With no API key, everything runs on a deterministic **mock** that implements the
grounding rules by hand. It proves the *machinery*; it is **not** a language model.

## Real-model mode (the truthfulness proof — still $0 on free Gemini)
```bash
cp .env.example .env
# put a free key from https://aistudio.google.com/apikey into GEMINI_API_KEY
npm run eval        # now the gate grades a REAL model's grounding behavior
```

## Switching providers (the portability guarantee)
Everything talks to the **OpenAI-compatible** `/chat/completions` surface — no vendor
SDK. Swap providers by editing `.env` only:
```
LLM_CHAIN=gemini,groq         # ordered failover chain; only keyed providers are used
GEMINI_API_KEY=...            # primary  (free or paid — paid = no training on data)
GROQ_API_KEY=...              # fallback on 429/5xx
# OLLAMA_BASE_URL=http://<oracle-box>:11434/v1   # self-hosted Gemma: $0 + private
```
Free Gemini → paid Gemini → self-hosted Gemma is a **config change, not a rewrite.**

## The eval gate (`npm run eval`)
- **Adversarial set** (`eval/adversarial.jsonl`): price / date / discount / seats /
  ISO / PMI-ATP / prompt-injection — all **must defer and must not fabricate**.
  Any fabrication → process exits non-zero → **deploy blocked**.
- **Positive set** (`eval/positive.jsonl`): real diploma/contact/vision questions
  that must be answered from the KB (so we don't "pass" by refusing everything).

## Layout
```
knowledge-base/   approved corpus + meta.json + GOVERNANCE.md   (the only source of truth)
src/
  config.ts       provider registry + chain from env            (add a provider = one row)
  providers.ts    OpenAI-compatible failover client (fetch)     (retry/backoff/degrade)
  mock.ts         deterministic $0 stand-in
  retrieve.ts     retrieveContext() — THE seam (full-context now, vector later)
  prompt.ts       refusal-first grounded prompt builder
  chat.ts         answer() — the one entry point
  cli.ts          interactive REPL
  server.ts       node:http front door — /health + /chat (zero deps, CORS + rate-limit)
eval/             the release gate
scripts/ask.ts    one-shot question
render.yaml       Render Blueprint (deploy-as-code; secrets are dashboard-only)
Dockerfile        portability — same container runs on any Docker host
```

## Run it as a service (HTTP)
```bash
npm run serve        # local: loads .env, listens on :8787
# GET  /health  → liveness + providerMode (no AI call) — used by keep-warm
# POST /chat    → { "question": "...", "history": [...] } → grounded JSON
curl -s localhost:8787/health
curl -s -X POST localhost:8787/chat -H 'Content-Type: application/json' \
  -H 'Origin: https://faact-academy.netlify.app' \
  -d '{"question":"ما هي الدبلومات المتاحة؟"}'
```
- **CORS** is locked to `ALLOWED_ORIGINS` (the FAACT origins only); other origins get `403`.
- **Rate limit** is per-IP, in-memory (`RATE_LIMIT_MAX`/min). HTTPS is terminated by the host.
- Zero runtime dependencies — `node:http` only, so swapping hosts stays a config move.

## Deploy (always-on, free) — Render
Host: **Render free Web Service**, defined in `render.yaml`. Sleeps on idle (~15min) → a
keep-warm pings `/health` (`.github/workflows/keep-warm.yml` or an external uptime monitor).
**Full steps, secret location, and the asleep-vs-dead-key-vs-rate-limit triage live in
`MAINTENANCE-RUNBOOK-DRAFT.md` (§2–§4).** The `GEMINI_API_KEY` is set in Render's secrets
panel (`sync:false` in the blueprint) — **never in the repo.**

## Recommended go-live default (decided at launch — see audit/ai-assistant/DECISIONS.md)
- **Demo now:** free Gemini Flash-Lite (or mock) — $0.
- **Production default I recommend:** **paid Gemini billing (~$5/mo)** — it stops the
  provider training on visitor questions (the real privacy liability) and raises limits.
- **$0-but-private alternative:** self-hosted Gemma on the Oracle box (no data egress).
Kept as config switches so Mohammed decides at launch without a rewrite.
