# Auto-apply v2 — plan

Owner: the "db overdoer" session. Started 2026-10-13. Status of each item is in **State** below; update it as work lands.

## Decisions (from the user)

- Rebuild auto-apply (it was removed earlier the same day together with the OpenAI features). It must **submit automatically**.
- No LLM drives navigation. Form flows are algorithmic (board/ATS adapters + heuristic matcher). **Ollama** (local, free, GPU via `OLLAMA_VULKAN=1`) is used only to (a) map ambiguous fields to profile keys with JSON-schema output and (b) draft free-text answers. No OpenAI anywhere.
- A "secure iframe" is impossible (`X-Frame-Options` / same-origin policy). The equivalent that works: a **dedicated persistent Chromium profile** driven by Playwright, headed, isolated from the user's browser; the user never visits the page, the dashboard shows screenshots.
- Unknown forms below the confidence threshold stop at the review step as `NEEDS_MANUAL`. CAPTCHAs pause for the user and are never bypassed.

## Status flow and schema

`PENDING → APPLYING → APPLIED | NEEDS_MANUAL | FAILED`

- `Application.errorMessage` (kept): failure reason / what needs manual completion.
- `Application.appliedVia`: adapter id (`startupjobs`, `teamio`, …), `generic`, or `ollama-assisted`.
- `Application.evidencePath`: `uploads/applications/<applicationId>` (gitignored).
- Migration `20261013212500_apply_v2_phase1` adds the two enum values and the two columns.

## Modules (all under my ownership)

| File | Role |
|---|---|
| `src/lib/apply/types.ts` | `ApplyProfile`, `ApplyJob`, `ApplyEvent`, `ApplyAdapter`, `ApplyAbort` |
| `src/lib/apply/browser.ts` | `launchPersistentContext(.apply-profile)`, headed unless `APPLY_HEADLESS=true`; `withApplyLock` serialises runs |
| `src/lib/apply/evidence.ts` | per-application dir: numbered step screenshots, `payload.json` (field → value entered), `log.txt` |
| `src/lib/apply/fieldMatcher.ts` | scans inputs/selects/textareas/file inputs across frames; scores label/name/id/autocomplete/placeholder/type against profile keys with CZ+EN synonyms; reports required-field coverage → confidence |
| `src/lib/apply/ollamaMapper.ts` | fallback: `ollamaChatJson` with a zod schema mapping unmatched fields; free-text answers |
| `src/lib/apply/formFiller.ts` | generic flow: find apply button → multi-step loop (fill visible step → next → rescan, max 6) → consent checkboxes → CV upload via `setInputFiles({name,mimeType,buffer})` from `CvDocument.data` → submit → confirmation detection (URL change / thank-you text / form gone) |
| `src/lib/apply/adapters/*.ts` | board/ATS-specific flows; selectors come from the form research report |
| `src/lib/apply/runner.ts` | loads application+job+profile+CV, picks adapter or generic, writes evidence, updates status/errorMessage/appliedAt/appliedVia/evidencePath |
| `src/app/api/apply/route.ts` | `POST {applicationId}` → SSE stream, same framing as `/api/scrape` |
| `src/app/api/apply/evidence/[applicationId]/[file]/route.ts` | auth-checked static serving of evidence files |
| `tests/unit/apply/*.test.ts` | matcher + synonym tests (vitest) |

Guards: CAPTCHA detection (frame src contains hcaptcha/recaptcha/turnstile) → `NEEDS_MANUAL`, page left open; login wall → `NEEDS_MANUAL`; auto-submit only when an adapter ran or confidence ≥ 0.8 with every required field matched.

## SSE event contract (for the dashboard)

```
data: {"type":"progress","message":"Opening posting…"}
data: {"type":"screenshot","url":"/api/apply/evidence/<id>/03-form.png"}
data: {"type":"done","status":"APPLIED"|"NEEDS_MANUAL","evidenceUrl":"/api/apply/evidence/<id>/","message":"…"}
data: {"type":"error","message":"…"}
```

UI (ui specialist): "Auto apply" button on `ApplicationCard`, live progress line + latest screenshot while `APPLYING`, chips for `APPLYING` / `NEEDS_MANUAL`, "Evidence" link, "Finish manually" link for `NEEDS_MANUAL`.

## Phases

1. **Now**: schema, core modules, generic filler, adapters for startupjobs.cz and jobs.cz/Teamio, API routes, dashboard button, matcher unit tests, one real end-to-end application with the user watching.
2. Remaining boards (nofluffjobs, cocuma, jobstack, skilleto, jooble) + ATS adapters (Greenhouse, Lever, Workable, SmartRecruiters, Teamtailor, Recruitee).
3. Matcher tuning from evidence trails; confidence threshold as a setting.
4. Optional: vision-model confirmation-page check; Ollama-drafted free-text answers.

## State (2026-10-19)

Done: schema + migration, `.gitignore` entries, `src/lib/ollama.ts`, all `src/lib/apply/*` modules (`types`, `browser`, `evidence`, `fieldMatcher` + 18 unit tests, `fieldScanner`, `pageActions`, `ollamaMapper`, `formFiller`, `runner`, `adapters/startupjobs`), `POST /api/apply` (body `{applicationId, dryRun?}`), `GET /api/apply/evidence/<id>` (listing) and `/<id>/<file>`. Dashboard side is in (ui specialist). The algorithm developer dropped the pgvector columns and the `extensions` block; `migrate dev` works again, the `vector` extension itself stays installed (owned by `postgres`).

Verified: dry run (`dryRun: true`) against a real startupjobs.cz posting through the shared dev server: CTA → modal → name, LinkedIn, e-mail, phone (national format because of the +420 prefix button), CV via the file-chooser button, confidence 0.987, stopped at "Odeslat zájem". Evidence trail and routes verified.

Lessons: the scanner scopes to an open modal; on the first page an apply CTA wins over stray inputs (the footer newsletter box was being filled before); an adapter's submit pattern is strict with no generic fallback; the browser singleton lives on `globalThis` because a Turbopack hot reload otherwise launches a second Chromium against the locked profile.

Update 2026-10-20: dry runs now pass on startupjobs.cz (modal, rich-text message drafted and filled, CV via file chooser), jobs.cz/Teamio (branded career sites, "Reply" → reply form, CV in the CV slot only, talent-pool opt-in left unchecked) and skilleto.cz (modal with generated ids, first/last name split, hidden custom checkboxes). jobstack.it and cocuma.cz (BambooHR) put reCAPTCHA in front of the form and end as NEEDS_MANUAL by design. Adapters: `startupjobs`, `jobscz`. Free text: `ollamaMapper.draftFreeText` writes the message from the CV text + job description in the posting's language, with a no-CV mode that never claims experience, a Czech proofreading pass and a shape guard (greeting line, signature). Writer model preference: `OLLAMA_WRITER_MODEL`, gemma3:12b, gemma3:4b, gemma2:9b, qwen2.5:7b, then the default model. Gemma 3 needs a newer Ollama than 0.22 on this machine; gemma2:9b is the practical choice until Ollama is updated.

Not yet: a real (non-dry) submission with the user watching; Phase 2 ATS adapters (Greenhouse, Lever, Workable, SmartRecruiters, Teamtailor, Recruitee) and nofluffjobs/jooble, which need postings in the local DB to test against.

## Coordination

- Peer sessions (message by name): **ui specialist** (dashboard), **algorithm developer** (`src/lib/jobs/**`, migrations), **cleaner** (comment stripping; owns restarts of the shared `:3000` server).
- Env precedence: Next and `prisma.config.ts` use dotenv first-wins → `.env.local` beats `.env`. `node --env-file` is **last-wins**, so scripts must pass `--env-file=.env --env-file=.env.local` in that order. `.env` still carries a live Neon `DATABASE_URL`; the user should comment it out (the harness blocks this session from editing `.env*`).
- Migrations on this machine: `prisma migrate dev` fails (shadow DB can't create the untrusted `vector` extension). Use `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` → review → write `prisma/migrations/<ts>_<name>/migration.sql` → `migrate deploy` → `generate`. Run Prisma as `node --env-file=.env.local node_modules/prisma/build/index.js …`.
- Test account: `test@test.com` / `testtest`. Scripts run with `npx tsx`.
