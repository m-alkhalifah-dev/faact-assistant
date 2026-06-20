# FAACT Assistant — Maintenance Runbook (DRAFT)

> Plain-language operating notes for whoever keeps the assistant running.
> DRAFT — written during the real-model proof (Session 1b). Add to it as we learn more.

---

## 1. Connect or rotate the AI key (disconnect-recovery)

**When you need this**

- The assistant starts replying **"The assistant is unavailable right now / تعذّر الوصول إلى المساعد حاليًا"** to ordinary questions it used to answer.
- You were told the key was disabled, leaked, or needs replacing.
- You're setting the assistant up on a new machine for the first time.

**What's happening:** the assistant talks to a free Google AI model using a single
text "key". If that key is missing, wrong, or expired, the assistant can't reach the
model and politely tells visitors to use WhatsApp instead. Replacing the key fixes it.
Nothing else needs to change.

**How to fix it (about 5 minutes, no coding):**

1. Open **https://aistudio.google.com/apikey** in your browser and sign in with the
   Google account we use for the academy.
2. Make sure you're in a project that has **no billing / no credit card attached**
   (this keeps it free — the model we use costs nothing on the free tier). If unsure,
   create a new project from that page; the free limits apply automatically.
3. Click **"Create API key"** and **copy** the long text it gives you.
   Treat it like a password — don't email it, don't paste it into chat, don't put it
   in any file we share or publish.
4. Paste the new key where the assistant reads it. **This depends on where it's running:**

   **A) Deployed (the live service — this is the normal case).** The key lives in the
   **host's secrets panel, NOT in any file.** On **Render**:
   - Go to **https://dashboard.render.com** → service **`faact-assistant`** → **Environment** tab.
   - Find **`GEMINI_API_KEY`**, click **Edit**, paste the new key (no spaces, no quotes), **Save**.
   - Render redeploys automatically. There is no `.env` file on the server and nothing to
     commit — the secret never touches Git.

   **B) Local machine (developer testing only).** Open **`faact-assistant/.env`** in a plain
   text editor, find `GEMINI_API_KEY=` and paste the key right after the `=`. Example shape
   (not a real key):

   ```
   GEMINI_API_KEY=AQ.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

   - Leave `GEMINI_MODEL=gemini-2.5-flash-lite` exactly as it is.
   - **Never commit or upload `.env`.** It is deliberately hidden from Git, so the key
     stays off GitHub. Only the example file (`.env.example`, which has a blank key) is
     shared.
5. **Restart / redeploy.** On Render, saving the variable (step 4A) restarts it for you.
   Locally, stop the assistant and start it again. The new key loads on startup.
6. Verify it worked: open the public **`/health`** URL — `providerMode` should read `gemini`
   (not `mock`). Then ask the assistant a normal question (e.g. "What diplomas do you
   offer?"). A real answer = the key is live. Still seeing "unavailable" = re-check
   steps 3–4 (most often a stray space, missing characters, or the key was created in
   a billing-disabled vs. enabled project). If `/health` says `providerMode: mock`, the
   key isn't loaded at all (see §4 triage).

**Good to know — the free model has usage limits.** On a busy burst (for example,
running the full test suite of ~24 questions back-to-back) the free tier can
temporarily refuse with a "rate limit" and the assistant will fall back to the
WhatsApp message for a short while, then recover on its own. This is normal and is
**not** a broken key — wait a minute (or up to a day for the daily cap to reset) and
it returns to normal. If you need it to keep answering under heavy load, that's when
we add a second free provider as an automatic backup (a Groq key in the same `.env`),
which is already wired and just needs a key.

> **Proof note:** a full 24/24 live eval run isn't reliable on free Gemini alone — the
> free tier is TPM-bound (token-per-minute) and the whole knowledge base ships with
> every request, so a back-to-back burst rate-limits after a few calls. The complete
> live proof needs either a Groq failover key or a paid Gemini key in place.

---

## 2. Where the service lives, and how to (re)deploy

**Host:** [Render](https://dashboard.render.com) — free **Web Service** named
**`faact-assistant`**, region Frankfurt. Defined as code in **`render.yaml`** (a Render
"Blueprint"). HTTPS/TLS is provided automatically by Render in front of the app.

**Public URLs** (fill in once deployed — Render assigns `https://<name>.onrender.com`):

- Health: `https://faact-assistant.onrender.com/health`  ← safe to open in any browser
- Chat:   `https://faact-assistant.onrender.com/chat`     ← POST only, used by the widget

**Two endpoints, nothing else:**

| Endpoint  | Method | Purpose                                                              |
| --------- | ------ | ------------------------------------------------------------------- |
| `/health` | GET    | Liveness + `providerMode`/KB version. No AI call. Used by keep-warm. |
| `/chat`   | POST   | `{ "question": "...", "history": [...] }` → grounded answer JSON.    |

**First-time deploy (one-time, ~10 min):**

1. Push this backend repo to GitHub (it is its own repo; the FAACT **site** repo is never touched).
2. Render → **New** → **Blueprint** → connect the repo. Render reads `render.yaml` and creates the service.
3. Render prompts for the two `sync:false` secrets — paste **`GEMINI_API_KEY`** (required) and
   **`GROQ_API_KEY`** (optional, leave blank for now). These go into Render's encrypted store,
   **never the repo.**
4. First deploy runs `npm install` then `node src/server.ts`. When the health check at `/health`
   goes green, it's live.

**Redeploy / update the code later:** push to the `master` branch on GitHub. `autoDeploy: true`
means Render rebuilds and ships automatically. To force one without a code change: Render dashboard
→ service → **Manual Deploy** → **Deploy latest commit**.

**Change a setting** (CORS origins, rate limit, model): edit the variable in Render →
**Environment** tab, or change `render.yaml` and push. Non-secret values can live in `render.yaml`;
secrets stay `sync:false` (dashboard-only).

**Porting to another host later** (Fly.io, Koyeb, Cloud Run, a VPS): the app is plain Node with
**zero runtime dependencies** and a **`Dockerfile`** is included. The only host-specific things are
(a) the secret values and (b) `PORT`, which every host injects. Set `GEMINI_API_KEY` +
`ALLOWED_ORIGINS` in the new host's secrets, point it at the repo or the Docker image, done — no
code rewrite. That portability is the reason we use the OpenAI-compatible provider layer and avoid
any vendor SDK.

---

## 3. Keep-warm (why the first visitor isn't greeted by a 30-second blank widget)

Render's **free** tier **sleeps the service after ~15 minutes of no traffic**. The next request
then pays a **cold start of ~30–50 seconds** while Render wakes it. To avoid a visitor hitting that,
something pings `/health` every ~12 minutes to keep it awake.

**Recommended (most reliable): an external uptime pinger.**

- **cron-job.org** (free) or **UptimeRobot** (free, 5-min interval): create one monitor that does a
  GET on the **`/health`** URL every 10–12 minutes. That's the whole setup.
- These are punctual and independent of GitHub.

**Built-in fallback: GitHub Actions** — `.github/workflows/keep-warm.yml` pings `/health` every
12 min. To use it: in the GitHub repo, **Settings → Secrets and variables → Actions → Variables**,
add a variable **`HEALTH_URL`** = the full `/health` URL. Honest caveats: GitHub's scheduler runs
*late* under load and **auto-disables scheduled workflows after 60 days of repo inactivity**, so the
external pinger above is the safer primary.

> **Tradeoff, stated plainly:** keep-warm trades a tiny, constant trickle of free-tier usage for no
> cold starts. It does **not** make the free tier limitless — if you ever want a guaranteed-instant,
> always-resident instance with no sleep at all, that's a paid plan (~\$7/mo on Render) and a
> separate decision. The 24/24 live-load proof remains deferred (see §1 proof note).

---

## 4. Triage: "asleep / cold-start" vs "dead key" vs "rate limit"

When the assistant misbehaves, these three look similar to a visitor but have different fixes.
**Start by opening the `/health` URL in a browser** — it never calls the AI, so it isolates the layer.

| Symptom                                                              | `/health` says                          | A `/chat` test shows                                      | Diagnosis            | Fix                                                                 |
| ------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------- | -------------------- | ------------------------------------------------------------------ |
| First request after a quiet period hangs ~30–50s, then works fine   | slow to load once, then **200**, fast   | slow once, then normal answers                           | **Asleep/cold-start**| Normal on free tier. Set up/verify keep-warm (§3). Nothing broken.  |
| Ordinary questions all return the WhatsApp "unavailable" message    | **200**, `providerMode: gemini`         | `degraded: true`, `provider: none`                       | **Dead/invalid key** | Rotate the key in Render secrets (§1‑A). Key is present but rejected.|
| Same as above, but it also won't answer simple KB facts as a model  | **200**, `providerMode: mock`           | answers exist but it's the offline mock, not the AI      | **Key not loaded**   | `GEMINI_API_KEY` missing/blank in Render. Add it (§1‑A).            |
| Works, then briefly fails under a burst, recovers on its own        | **200**, `providerMode: gemini`         | intermittent `degraded: true`; fine again after a minute | **Rate limit (429)** | Free-tier TPM cap. Wait it out, or add a `GROQ_API_KEY` failover.   |
| `/chat` returns HTTP **429** `rate limit exceeded`                  | **200**                                 | our own per-IP limiter tripped (default 20/min)          | **Our rate limiter** | Expected under hammering. Raise `RATE_LIMIT_MAX` if too tight.      |
| Browser console: CORS error / blocked; `/chat` returns **403**      | **200**                                 | `403 origin not allowed`                                 | **CORS**             | The page's origin isn't in `ALLOWED_ORIGINS`. Add it (§2).          |

**Key signals to remember:**

- **`providerMode` on `/health`** is the fastest tell: `gemini` = a key is loaded; `mock` = no key.
  It does **not** prove the key is *valid* (it doesn't call the AI) — for that, do a `/chat` test and
  look at `degraded`.
- **`degraded: true` + `provider: none`** in a `/chat` reply = every provider failed (dead key *or* a
  full rate-limit exhaustion). The visitor still gets a polite WhatsApp hand-off, never an error.
- **HTTP 429** = a limiter said "slow down": ours (per-IP) returns `{"error":"rate limit exceeded"}`;
  the AI provider's shows up as `degraded` instead. Different layers, both transient.
