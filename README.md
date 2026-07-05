# GovSpend Security Questionnaire

Internal tool for auto-drafting responses to customer security questionnaires. Replaces Iris/heyiris.ai.

**Answers are grounded only in approved internal KB entries — never the open web or model memory.**

## Architecture

```
Next.js (App Router) + TypeScript → Vercel
Supabase (Postgres + pgvector + Auth + Storage)
Inngest (background job fan-out, per-question retries)
Voyage AI (voyage-3-large embeddings + rerank-2)
Anthropic Claude API (Sonnet for bulk drafting, Opus for hard questions)
```

Pipeline per question:
1. **Hybrid search** — pgvector (semantic) + tsvector (keyword) fused with RRF
2. **Rerank** — Voyage `rerank-2` over fused candidates
3. **Classify & answer** — Claude classifies into `grounded | gap_standard | gap_nda | gap_in_progress`; app renders fixed placeholder strings (model never writes them)
4. **Route** — gap answers and low-confidence answers auto-route to DevSecOps review queue
5. **Approve** — canonical answers only promoted after admin click; versioned

## Setup

### 1. Create a Supabase project

1. Go to supabase.com → New project
2. Enable the **pgvector** extension (Database → Extensions → vector)
3. Run migrations in the SQL editor in order (0001 → 0004), or with the CLI:
   ```bash
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```
4. Configure **Google OAuth** (Authentication → Providers → Google):
   - Authorized domain: `govspend.com`
   - Redirect URL: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`
5. Create a **Storage bucket** named `augur` (private)

### 2. Create a Vercel project

1. Push this repo to `github.com/govspend/security-questionnaire`
2. Import into Vercel, framework = Next.js
3. Add all env vars from `.env.example` to Vercel environment settings
4. Enable **Vercel Protection** on the project

### 3. Set up Inngest

1. Create account at inngest.com → create an app
2. Copy Event Key and Signing Key into env vars
3. After first deploy: Inngest dashboard → Apps → Sync → `https://YOUR_DOMAIN/api/inngest`

### 4. Local development

```bash
cp .env.example .env.local
# Fill in all values

npm install
npx inngest-cli dev    # Inngest dev server on :8288
npm run dev            # Next.js on :3000
```

### 5. Seed the KB

```bash
# Get admin user UUID from Supabase → Auth → Users
SEED_USER_ID=your-uuid npx tsx scripts/import-kb.ts \
  "path/to/GovSpend Security Questionnaire Answer Bank.xlsx"
```

## Roles

| Role | Can do |
|---|---|
| **Rep** | Upload questionnaires, view answers (NDA answers show placeholder) |
| **Admin** | Approve/reject/edit answers, see NDA answers, manage review queue |

## Gap placeholders

The model classifies into one of four types; the **app** renders the fixed string — the model never writes these:

| Type | Shown to Reps |
|---|---|
| `gap_standard` | "This question requires review by GovSpend's DevSecOps team…" |
| `gap_nda` | "Available under NDA. GovSpend can share this documentation…" |
| `gap_in_progress` | "GovSpend has established a formal ISMS and is currently undergoing SOC 2 certification…" |

## Project structure

```
app/
  auth/                   Sign-in + OAuth callback
  dashboard/
    page.tsx              Questionnaire list
    new/                  Upload / paste form
    questionnaires/[id]/  Workspace split view
    review/               DevSecOps queue (admin only)
  api/
    inngest/              Inngest webhook
    questionnaires/       REST endpoints
lib/
  constants.ts            Placeholder strings, enums — single source of truth
  ai/pipeline.ts          Grounded answer generation
  ai/column-mapper.ts     LLM-assisted Excel column detection
  ai/prompts.ts           All system prompts
  supabase/               Client, server, types
  voyage.ts               Embed + rerank
  search.ts               Hybrid search (calls Supabase RPC)
  excel/                  ExcelJS reader + writer
inngest/functions/        process-questionnaire, answer-question
scripts/import-kb.ts      One-time KB seeder
supabase/migrations/      0001-0004 SQL files (run in order)
```

## Phase roadmap

- **Phase 1 (current):** SSO, KB seeding, Excel/paste intake, LLM column mapping, hybrid retrieval + rerank, grounded answer pipeline, workspace UI, review queue, audit log
- **Phase 2:** Word/PDF intake, Excel/Word write-back export, question deduplication, staleness reminders, analytics
- **Phase 3:** Web-portal paste helper, eval harness (golden set + LLM-as-judge), Slack notifications
