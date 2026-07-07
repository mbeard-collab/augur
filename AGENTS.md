# Augur — Agent Orientation

> **⚠ This is Next.js 16, not the Next.js you know from training data.**
> Breaking changes are real: `middleware.ts` → `proxy.ts`, exported function renamed `proxy`,
> and other convention shifts. Read `node_modules/next/dist/docs/` before writing routing code.
> Heed deprecation notices.

## What this app does

Augur is GovSpend's internal security questionnaire automation tool. Customers send security
questionnaires (Excel, Word, PDF, or pasted text); Augur extracts each question, runs a hybrid
vector + keyword search against an approved knowledge base, calls Claude to classify and draft a
grounded answer, and surfaces results in a review workspace where admins approve, edit, or route
items to DevSecOps. It replaces the paid external vendor Iris/heyiris.ai.

## Stack

| Layer           | Technology |
|-----------------|-----------|
| Framework       | Next.js 16.2.9 — App Router, TypeScript, Tailwind 4 |
| Database        | Supabase Postgres + pgvector (1024-dim) + RLS |
| Auth            | Supabase Auth — email/password; `@govspend.com` enforced in `proxy.ts` |
| Storage         | Supabase Storage — bucket `augur`, path `{user-uuid}/{ts}-{filename}` |
| Background jobs | Inngest v4 — webhook at `/api/inngest` |
| Embeddings      | Voyage AI `voyage-3-large` (1024 dims) + `rerank-2` reranker |
| LLM             | Anthropic Claude via Vercel AI SDK — Sonnet 4.6 default, Opus 4.8 hard questions, Haiku column detection |
| Validation      | Zod v4 |

## Commands

```bash
npm run dev           # Next.js dev server on :3000
npm run build         # production build
npm run type-check    # tsc --noEmit  ← run before every commit; no test suite exists
npm run lint          # eslint
npm run import-kb     # seed KB: SEED_USER_ID=<uuid> npm run import-kb path/to/AnswerBank.xlsx
npm run sync-drive    # sync KB from Google Drive (see CONTRIBUTING.md Workflow 7)
npm run sync-drive -- --force   # force re-process all files, ignore incremental cache

npx inngest-cli@latest dev   # local Inngest dev server on :8288 (run alongside next dev)

# Deploy to production (auto-deploy from git push is disabled — run this after every push)
npx vercel --prod --yes
```

## Directory Map

```
app/
  api/
    inngest/route.ts                     Inngest webhook (GET/POST/PUT)
    questionnaires/route.ts              List + create questionnaires
    questionnaires/[id]/route.ts         Fetch questionnaire + questions + answers
    questionnaires/[id]/answers/route.ts Approve / reject / edit / route answers (PATCH)
  auth/page.tsx                          Login form (email + password)
  auth/callback/route.ts                 OAuth callback — DEAD CODE (replaced by password auth)
  dashboard/
    layout.tsx                           Sidebar nav, auth guard
    page.tsx                             Questionnaire list
    new/page.tsx                         Upload / paste form
    questionnaires/[id]/page.tsx         Workspace server shell → WorkspaceShell
    review/page.tsx                      DevSecOps review queue (admin only)
    kb/page.tsx                          Admin Knowledge Base viewer (search + filter)
components/workspace/
  WorkspaceShell.tsx                     Client: selection state, 3 s polling while processing
  QuestionList.tsx                       Left panel: question list with j/k keyboard nav
  AnswerPanel.tsx                        Right panel: answer + actions (approve/edit/route/reject)
inngest/
  client.ts                              Inngest client + typed Events map
  functions/process-questionnaire.ts     questionnaire/uploaded → extract questions → fan out
  functions/answer-question.ts           question/answer → generate + persist (concurrency 5/questionnaire)
lib/
  ai/pipeline.ts                         Core: hybridSearch → Claude → classify + draft
  ai/prompts.ts                          ALL system prompts — single source of truth for prompt wording
  ai/column-mapper.ts                    Claude Haiku detects question/answer columns in spreadsheets
  constants.ts                           ALL enums, gap placeholders, thresholds — SINGLE SOURCE OF TRUTH
  search.ts                              hybridSearch(): Voyage embed → hybrid_search RPC → Voyage rerank
  excel/reader.ts                        ExcelJS question extraction
  excel/writer.ts                        ExcelJS answer write-back into original workbook
  supabase/client.ts                     Browser client (createBrowserClient)
  supabase/server.ts                     Server client (cookies) + service client (service role)
  supabase/types.ts                      Hand-written DB types — regenerate after schema changes
  voyage.ts                              VoyageAIClient wrapper: embedText, embedTexts, rerank
  utils.ts                               formatDistanceToNow, cn()
proxy.ts                                 Auth guard + @govspend.com domain enforcement
scripts/import-kb.ts                     One-shot KB seeder from Excel
scripts/sync-drive.ts                    Google Drive KB sync (spreadsheets → kb_entries, docs → evidence_docs)
scripts/mcp-import.ts                    Process MCP-staged Drive content (drive-staging.json) → Supabase KB
config/google-service-account.json      Service account key (gitignored — never commit)
.drive-sync-state.json                  Incremental sync cache (gitignored — maps fileId → modifiedTime)
supabase/migrations/                     0001 tables, 0002 RLS, 0003 functions, 0004 progress RPC
```

## Must-Follow Conventions

1. **`lib/constants.ts` is the single source of truth for all enums and thresholds.**
   Never hardcode `'grounded'`, `'gap_standard'`, `'nda_gated'`, status strings, etc. in components
   or routes. Import from `constants.ts`. SQL CHECK constraints must stay in sync with it.

2. **The model never writes gap placeholder text.**
   `lib/ai/pipeline.ts → resolveDisplayText()` is the only place that renders the three gap strings.
   Do not read `GAP_PLACEHOLDERS` anywhere else in the UI.

3. **`lib/ai/prompts.ts` is the single source of truth for all prompt text.**
   Compliance-sensitive wording changes must go here, never inline.

4. **Supabase types are hand-written in `lib/supabase/types.ts`.**
   After any migration, regenerate with:
   `npx supabase gen types typescript --project-id lfmmjjozvxctepedjmjw > lib/supabase/types.ts`
   Then manually re-add `Relationships: []` (or FK arrays) to every table — the generator omits them
   and Supabase v2.108 requires them or queries return `never`.

5. **Inngest v4 uses a two-argument `createFunction` API.**
   `createFunction({ id, name, triggers: […] }, async ({ event, step }) => {…})`
   The three-argument form does not exist in v4.

6. **`createServiceClient()` for Inngest functions and scripts; `createClient()` for route handlers.**
   Never use the service-role client inside a user-facing route — it bypasses RLS.

7. **`proxy.ts` (not `middleware.ts`).**
   Next.js 16 renamed the file convention. The exported function must be named `proxy`.

8. **No test suite — `npm run type-check` is the main automated guard.**
   Run it before committing.

## Known Bugs

All three original known bugs are **fixed** (commit f78eaa1):
- `AnswerPanel.tsx` — answer actions now use `question.questionnaire_id` ✓
- `/dashboard/kb` — KB admin page created ✓
- `'portal'` source_format — treated as `paste` (questions pre-inserted) ✓

**Additional fixes (commit 70127b6):**
- Paste questionnaire: `paste_text` lines were never parsed into `questions` rows before Inngest fired — now inserted in the POST route before the event is sent ✓

## Known Limitations

- **Workspace polling**: if the page was loaded while a questionnaire was still processing and all answers complete before the next 3-second poll, the UI may stay on the spinner. Hard-refresh (Cmd+Shift+R) loads the final state from the server.

## Reference Docs

- Full data model, integration details, change-coupling map: `docs/architecture.md`
- Step-by-step change workflows: `CONTRIBUTING.md`
