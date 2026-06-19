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
4. On the server, open the file **`faact-assistant/.env`** in a plain text editor.
   Find the line that begins with `GEMINI_API_KEY=` and paste the new key right after
   the `=`, with no spaces and no quotes. Example shape (not a real key):

   ```
   GEMINI_API_KEY=AQ.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

   - Leave `GEMINI_MODEL=gemini-2.5-flash-lite` exactly as it is.
   - **Never commit or upload `.env`.** It is deliberately hidden from Git, so the key
     stays off GitHub. Only the example file (`.env.example`, which has a blank key) is
     shared.
5. **Save the file and restart the assistant** (stop it and start it again). The new
   key loads on startup — there is nothing else to click.
6. Verify it worked: ask the assistant a normal question (e.g. "What diplomas do you
   offer?"). A real answer = the key is live. Still seeing "unavailable" = re-check
   steps 3–4 (most often a stray space, missing characters, or the key was created in
   a billing-disabled vs. enabled project).

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
