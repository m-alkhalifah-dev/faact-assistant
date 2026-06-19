# Knowledge-Base Governance

The assistant answers **only** from this `knowledge-base/`. That makes this folder
*published content under the same liability bar as the website* — so it carries the
same approval gate (see project ADR 0008 / 0012, and the `rag-knowledge-base` skill §3).

## Rules

1. **Approval gate.** No content enters `faact.kb.md` without Dr. Fahd's sign-off
   (gate **D-2**). Until then `meta.json.approved` stays `false` and the corpus is a
   PLACEHOLDER for the demo. **Do not deploy with `approved: false`.**

2. **Separate from the site's content tree — on purpose.** This KB is NOT generated
   from the live site's data files or any future Content Collection. It is a
   *curated, version-pinned artifact*. A copy edit on the site must never silently
   change what the assistant claims about accreditation or careers.

3. **Danger topics are fenced, not answered.** Prices, fees, cohort/start dates, seat
   availability, discount codes, PMI-ATP status, and any unlisted accreditation/
   certificate body are listed under "NOT available here" and in `meta.json.fencedTopics`.
   The assistant defers these to a human (WhatsApp). It never estimates them.

4. **Only already-public, approved facts.** Everything here is content already live on
   the approved FAACT site. No internal documents, no student data, no draft/aspirational
   copy.

## Updating the KB (after go-live)

1. Get Dr. Fahd's approval for the change (same rule as the website).
2. Edit `faact.kb.md`; bump `meta.json.version`; set `approved`, `approvedBy`, `approvedDate`.
3. Run `npm run eval` — the adversarial gate must stay green before the change ships.
   A made-up price/date/accreditation in any answer is a **failed build**, not a tuning note.
