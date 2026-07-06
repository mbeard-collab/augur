# Augur — Architecture Reference

> This document is loaded on demand. For the always-on orientation, see `AGENTS.md`.

---

## Data Model

All tables live in the `public` schema. Migrations are in `supabase/migrations/`.

### Tables

**`profiles`** — one row per auth user; created automatically by `handle_new_user()` trigger.
```
id          UUID  PK → auth.users(id)
email       TEXT  NOT NULL
role        TEXT  'rep' | 'admin'   default 'rep'
full_name   TEXT
avatar_url  TEXT
```

**`kb_entries`** — the approved answer bank. The AI pipeline searches only `approved` rows.
```
id             UUID  PK
domain         TEXT                          e.g. "Access Control"
question       TEXT                          canonical question text
answer         TEXT                          approved answer text
citations      JSONB  []                     array of Citation objects
tier           TEXT  'public'|'public_review'|'nda_gated'
confidence     TEXT  'high'|'medium'|'gap'
status         TEXT  'draft'|'pending_review'|'approved'|'rejected'|'archived'
embedding      VECTOR(1024)                  voyage-3-large; NULL until seeded
question_tsv   TSVECTOR  GENERATED           full-text search index on question
internal_notes TEXT
version        INT   default 1               bumped on answer/citations/tier change
approved_by    UUID → profiles(id)
approved_at    TIMESTAMPTZ
```

**`evidence_docs`** — source policy documents for grounding. <!-- ASSUMPTION: not yet integrated into the search pipeline — hybrid_search only queries kb_entries. Confirm whether evidence_docs are meant to be searched alongside kb_entries in a future phase. -->
```
id         UUID  PK
title      TEXT
section    TEXT
content    TEXT
embedding  VECTOR(1024)
tsv        TSVECTOR  GENERATED
nda_gated  BOOLEAN  default false
source_url TEXT
```

**`questionnaires`** — one per customer upload / job.
```
id               UUID  PK
name             TEXT
customer         TEXT
source_format    TEXT  'excel'|'word'|'pdf'|'paste'|'portal'
file_path        TEXT  storage path: {user-uuid}/{ts}-{filename}
status           TEXT  'pending'|'processing'|'answering'|'complete'|'failed'
progress         JSONB  {"total":N,"answered":N,"routed":N}
inngest_event_id TEXT  returned by inngest.send()
error_message    TEXT
uploaded_by      UUID → profiles(id)
```

**`questions`** — extracted from a questionnaire; one row per question.
```
id               UUID  PK
questionnaire_id UUID → questionnaires(id) CASCADE
raw_text         TEXT
normalized_text  TEXT  (unused in current pipeline)
location_ref     TEXT  e.g. "Sheet1!B5"
sequence_index   INT
dedupe_group     UUID  groups near-identical questions (unused in current pipeline)
```

**`answers`** — one per question, written by the Inngest job.
```
id                   UUID  PK
question_id          UUID → questions(id) CASCADE
kb_entry_id          UUID → kb_entries(id)
answer_text          TEXT  stores display_text (gap placeholders are pre-resolved before insert)
answer_type          TEXT  'grounded'|'gap_standard'|'gap_nda'|'gap_in_progress'
citations            JSONB  []
confidence           TEXT  'high'|'medium'|'gap'
tier                 TEXT  'public'|'public_review'|'nda_gated'
status               TEXT  'draft'|'pending_review'|'approved'|'rejected'
source               TEXT  'ai'|'kb'|'human'
routed_to_devsecops  BOOLEAN
generation_metadata  JSONB  {model, retrieval_ids[]}
```

**`review_queue`** — items that need DevSecOps attention.
```
id         UUID  PK
answer_id  UUID → answers(id) CASCADE
reason     TEXT  'low_confidence'|'no_match'|'nda_gated'|'in_progress'|'edited'|'manual'
assignee   UUID → profiles(id)
status     TEXT  'open'|'in_review'|'resolved'|'dismissed'
notes      TEXT
```

**`audit_log`** — append-only (Update type is `never` in TypeScript types).
```
id          UUID  PK
actor_id    UUID → profiles(id)
action      TEXT  'generate'|'approve'|'reject'|'edit'|'route'|'export'|'kb_import'
entity_type TEXT  'answer'|'kb_entry'|'questionnaire'
entity_id   UUID
metadata    JSONB
```

### DB Functions

| Function | Purpose |
|----------|---------|
| `hybrid_search(query_embedding, query_text, match_count, ...)` | RRF fusion of vector + keyword search over `kb_entries`; returns top K rows with scores |
| `increment_progress(p_questionnaire_id, p_routed)` | Atomic JSONB counter increment; auto-transitions questionnaire to `complete` when answered === total |
| `get_user_role()` | `SECURITY DEFINER` — returns `auth.uid()`'s role; called inside RLS policies |
| `handle_new_user()` | `AFTER INSERT ON auth.users` — creates `profiles` row automatically |
| `bump_kb_version()` | `BEFORE UPDATE ON kb_entries` — increments `version` when answer, citations, or tier changes |
| `handle_updated_at()` | `BEFORE UPDATE` trigger on most tables — sets `updated_at = NOW()` |

### Indexes

- `kb_entries_embedding_idx` — ivfflat cosine (lists=100) on `embedding`
- `kb_entries_tsv_idx` — GIN on `question_tsv`
- `evidence_docs_embedding_idx` — ivfflat cosine on `embedding`
- `evidence_docs_tsv_idx` — GIN on `tsv`

---

## External Integrations

### 1. Supabase Auth
- **What:** Email/password auth. `@govspend.com` domain enforced in `proxy.ts:43` via `user.email.endsWith()`.
- **How wired:** `@supabase/ssr` — browser client (`lib/supabase/client.ts`) uses `createBrowserClient`; server client (`lib/supabase/server.ts`) uses `createServerClient` with cookie store.
- **Automatic:** `handle_new_user()` trigger creates a `profiles` row on every new signup.
- **Manual:** Admins created via Supabase Auth dashboard or Admin API; role set via SQL: `UPDATE profiles SET role = 'admin' WHERE email = '...'`.

### 2. Supabase Storage
- **Bucket:** `augur` (private). Max 50 MB. Allowed: xlsx, xls, doc, docx, pdf, txt.
- **Path convention:** `{user-uuid}/{unix-ts}-{original-filename}`
- **Upload:** `app/api/questionnaires/route.ts` — on `POST /api/questionnaires` with a file.
- **Download:** `inngest/functions/process-questionnaire.ts` — to extract questions.
- **RLS:** INSERT requires `auth.uid()::text === folder name`; SELECT requires own folder or admin role.

### 3. Voyage AI
- **File:** `lib/voyage.ts` — wraps `VoyageAIClient` (named export, not default).
- **`embedText(text)`** → `number[]` (1024 dims) — used in `lib/search.ts` to embed the incoming question.
- **`embedTexts(texts)`** → `number[][]` — used in `scripts/import-kb.ts` in batches of 96.
- **`rerank(query, candidates, topK)`** → reranked `SearchResult[]` — called after hybrid_search RPC.
- **Models:** `voyage-3-large` (embeddings), `rerank-2` (reranking).
- **Triggered:** automatically on every `question/answer` job via `generateGroundedAnswer()`.

### 4. Anthropic Claude
- **File:** `lib/ai/pipeline.ts` — uses `generateObject()` from `ai` (Vercel AI SDK) with a Zod schema.
- **Models:**
  - `claude-sonnet-4-6` — default for all questionnaire answers.
  - `claude-opus-4-8` — promoted to when `useOpus=true` is passed to `generateGroundedAnswer()`. <!-- ASSUMPTION: the `useOpus` flag is not currently set to true anywhere in the call chain. It defaults to false in `answer-question.ts`. Confirm whether there is an intended trigger for Opus promotion. -->
  - `claude-haiku-4-5-20251001` — used only in `lib/ai/column-mapper.ts` for cheap spreadsheet column detection.
- **Triggered:** automatically on every `question/answer` Inngest job.
- **Output:** structured JSON matching `AnswerSchema` (Zod). Temperature = 0.

### 5. Inngest
- **Webhook endpoint:** `app/api/inngest/route.ts` (GET/POST/PUT served by `inngest/next`).
- **Client ID:** `security-questionnaire` (set in `inngest/client.ts`).
- **Functions registered:**

  | Function | Trigger event | Concurrency | Retries |
  |----------|--------------|-------------|---------|
  | `process-questionnaire` | `questionnaire/uploaded` | 3 global | 2 |
  | `answer-question` | `question/answer` | 5 per `questionnaire_id` | 3 |

- **Event payload shapes** are typed in `inngest/client.ts → Events`.
- **Firing:** `inngest.send()` called in `app/api/questionnaires/route.ts` after questionnaire insert.

---

## Processing Pipeline (end-to-end)

```
User uploads file
  → POST /api/questionnaires
  → file stored in augur bucket
  → questionnaires row inserted (status: 'pending')
  → inngest.send('questionnaire/uploaded')

processQuestionnaire (Inngest):
  → status = 'processing'
  → download file from storage (or read pasted questions)
  → extract questions via ExcelJS → insert into questions table
  → status = 'answering', progress = {total: N, answered: 0, routed: 0}
  → step.sendEvent: one 'question/answer' event per question

answerQuestion (Inngest, ×N, concurrency 5/questionnaire):
  → generateGroundedAnswer(raw_text, uploader_role)
      → Voyage: embedText(question) → vector
      → Supabase RPC: hybrid_search(embedding, text) → top 20 RRF-fused candidates
      → Voyage: rerank(question, candidates, 8) → top 8
      → Claude: generateObject(AnswerSchema) → {answer_type, answer_text, confidence, tier, citations}
      → resolveDisplayText() → final display_text (may be a GAP_PLACEHOLDER)
  → insert into answers (answer_text = display_text)
  → if routed: insert into review_queue
  → RPC: increment_progress (auto-completes questionnaire when answered === total)
  → insert into audit_log

Workspace (client):
  → WorkspaceShell polls GET /api/questionnaires/{id} every 3 s while status is 'processing'|'answering'
  → stops polling on 'complete' or 'failed'
```

---

## Change-Coupling Map

> **Blast-radius rule:** Before completing any change, trace it through this map and update every
> coupled location. A change is not done until the whole trace is done.

### A. Adding or renaming an `answer_type` value

| File | What to change |
|------|---------------|
| `supabase/migrations/` | New migration: `ALTER TABLE answers DROP CONSTRAINT ...; ALTER TABLE answers ADD CONSTRAINT ... CHECK (answer_type IN (...))` |
| `lib/supabase/types.ts` | `answers` Row + Insert union literal |
| `lib/constants.ts` | `AnswerType` type; `GAP_ANSWER_TYPES` array if it's a gap; `ROUTE_REASON_BY_TYPE` map if it maps to a review reason |
| `lib/ai/pipeline.ts` | `AnswerSchema` z.enum; `resolveDisplayText()` switch logic |
| `lib/ai/prompts.ts` | `GROUNDED_ANSWER_SYSTEM` — gap variant descriptions |
| `components/workspace/AnswerPanel.tsx` | `AnswerTypeBadge.labels` map; `isGap` boolean check (`answer.answer_type !== 'grounded'`) |
| `components/workspace/QuestionList.tsx` | `AnswerTypeDot.colors` map |

### B. Adding or renaming a `review_queue.reason` value

| File | What to change |
|------|---------------|
| `supabase/migrations/` | New migration: update CHECK constraint on `review_queue.reason` |
| `lib/supabase/types.ts` | `review_queue` Row + Insert union literal |
| `lib/constants.ts` | `ReviewReason` type; `ROUTE_REASON_BY_TYPE` map if it maps from an answer_type |
| `inngest/functions/answer-question.ts` | Uses `ROUTE_REASON_BY_TYPE` to derive reason — update there if needed |
| `app/api/questionnaires/[id]/answers/route.ts:41` | Hardcodes `reason: 'manual'` for the 'route' action — update if 'manual' is renamed |
| `app/dashboard/review/page.tsx` | `ReasonChip.styles` map + `ReasonChip.labels` map |

### C. Adding a field to `kb_entries`

| File | What to change |
|------|---------------|
| `supabase/migrations/` | New migration: `ALTER TABLE kb_entries ADD COLUMN ...` |
| `lib/supabase/types.ts` | `kb_entries` Row, Insert, Update types |
| `supabase/migrations/0003_functions.sql` | `hybrid_search()` RETURNS TABLE — add field if it should be returned |
| `lib/supabase/types.ts` | `Functions.hybrid_search.Returns` array type |
| `lib/search.ts` | `RpcRow` type + `SearchResult` interface if field returned by search |
| `lib/ai/pipeline.ts` | `buildContextBlock()` if field should be shown to the model |
| `scripts/import-kb.ts` | Column mapping + insert records if field comes from the Excel source |

### D. Changing a gap placeholder string

| File | What to change |
|------|---------------|
| `lib/constants.ts` | `GAP_PLACEHOLDERS.standard` / `.nda` / `.in_progress` |
| `lib/ai/prompts.ts` | `GROUNDED_ANSWER_SYSTEM` — the model must understand the same gap classification names |
| **Runtime note** | Changing placeholder text only affects NEW answers. Existing `answers.answer_text` rows already store the old rendered text. A backfill migration is needed to update existing answers. |

### E. Renaming the storage bucket

| File | What to change |
|------|---------------|
| `app/api/questionnaires/route.ts:44` | `.from('augur')` → `.from('new-name')` |
| `inngest/functions/process-questionnaire.ts:48` | `.from('augur')` → `.from('new-name')` |
| Supabase dashboard | Delete and recreate bucket; re-apply RLS policies |

### F. Changing an Inngest event name or payload shape

| File | What to change |
|------|---------------|
| `inngest/client.ts` | `Events` type map — event name key + data shape |
| `app/api/questionnaires/route.ts` | `inngest.send({ name: 'questionnaire/uploaded', data: {...} })` |
| `inngest/functions/process-questionnaire.ts` | `triggers: [{ event: 'questionnaire/uploaded' }]`; `step.sendEvent('fan-out', [{name: 'question/answer', data: {...}}])` |
| `inngest/functions/answer-question.ts` | `triggers: [{ event: 'question/answer' }]`; destructured `event.data` shape |

### G. Adding a new `questionnaire.source_format` value

| File | What to change |
|------|---------------|
| `supabase/migrations/` | New migration: update CHECK constraint |
| `lib/supabase/types.ts` | `questionnaires` Row + Insert `source_format` union |
| `app/dashboard/new/page.tsx` | File extension → format mapping logic in `submit()` |
| `inngest/functions/process-questionnaire.ts` | Add a processing branch for the new format (currently only `'paste'` and file-based are handled) |

### H. Adding a new user role

| File | What to change |
|------|---------------|
| `supabase/migrations/` | New migration: update CHECK constraint on `profiles.role` |
| `lib/supabase/types.ts` | `profiles` Row + Insert `role` union |
| `lib/constants.ts` | `UserRole` type |
| `supabase/migrations/0002_rls.sql` | All policies that check `get_user_role() = 'admin'` — decide if new role gets same access |
| `app/dashboard/layout.tsx` | `isAdmin` conditional — add logic for new role |
| `app/dashboard/review/page.tsx` | Role check redirect on line 13 |
| `app/api/questionnaires/[id]/answers/route.ts` | Approve-only-admin check on line 23 |
| `lib/ai/pipeline.ts` | `resolveDisplayText()` NDA-gating logic checks `userRole === 'rep'` — update if new role should see NDA content |

---

## Non-Obvious Design Decisions

**The model never writes placeholder text.**
Gap placeholder strings are defined in `lib/constants.ts → GAP_PLACEHOLDERS` and rendered only by
`lib/ai/pipeline.ts → resolveDisplayText()`. The model classifies into one of four answer types;
the app maps that to the fixed string. This ensures the compliance-critical wording can only change
in one place and is never influenced by model output variation.

**`answers.answer_text` stores the resolved display text, not raw model output.**
When a rep uploads a questionnaire, NDA-gated grounded answers are stored as the NDA placeholder,
not the underlying KB answer text. This means the DB stores what was shown, not what the model
found. Admins see the raw answer text because `resolveDisplayText()` does not replace grounded
answers with the placeholder for admin-role uploaders.

**Supabase types are hand-written, not generated.**
`supabase gen types` omits `Relationships: GenericRelationship[]` from every table, which Supabase
v2.108's `GenericTable` requires. Without it, `.select()` return types resolve to `never`. After
any schema change, regenerate and manually re-add the `Relationships` fields.

**Session pooler vs. direct DB connection.**
Direct connections to Supabase use IPv6 by default. The session pooler
(`aws-1-us-west-2.pooler.supabase.com:5432`, user `postgres.{project-ref}`) is IPv4-compatible.
Use the pooler for any direct psql / `pg` access from a Mac or IPv4-only environment. The
application's Supabase JS client connects over HTTPS and is not affected.

**`evidence_docs` table is built but not yet searched.**
The schema, embedding index, and GIN index exist for `evidence_docs`, but `hybrid_search()` only
queries `kb_entries`. Evidence docs are intended for a second retrieval pass (policy grounding)
that has not yet been implemented.

**Inngest concurrency key is per-questionnaire, not global.**
`answer-question` limits 5 concurrent Claude calls per `questionnaire_id`. Multiple simultaneous
questionnaires each get their own 5-slot budget, so actual global concurrency scales with the
number of active uploads.

---

## Known Issues

| Location | Issue |
|----------|-------|
| `components/workspace/AnswerPanel.tsx:39` | API URL built with `answer.question_id.split('-')[0]` instead of `question.questionnaire_id`. All answer actions (Approve/Edit/Route/Reject) send requests to a wrong path and will 404. |
| `app/dashboard/layout.tsx:31` | "Knowledge Base" nav link points to `/dashboard/kb` — no page exists at that route. Will 404 for admins. |
| `inngest/functions/process-questionnaire.ts` | `'portal'` source_format is in the enum but has no handling branch. A portal-type questionnaire with `file_path = null` will throw `'No file_path on questionnaire'`. |
| `app/auth/callback/route.ts` | Dead code — OAuth was replaced by email/password auth. The callback route is no longer reachable. |
| `components/workspace/AnswerPanel.tsx:5` | `GAP_PLACEHOLDERS` is imported but never referenced in the component body. Dead import. |
| `lib/constants.ts` | `CONFIDENCE_THRESHOLDS` (`{ high: 0.80, medium: 0.50 }`) is defined but not used anywhere in the current pipeline. The model returns confidence as a string enum directly. |
