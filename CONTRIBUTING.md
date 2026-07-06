# Contributing to Augur

Before making any change, read `AGENTS.md` (orientation) and the relevant section of
`docs/architecture.md` (data model + change-coupling map). Run `npm run type-check` after
every change; there is no test suite.

---

## Workflow 1 — Add a field to an existing table

Example: adding `due_date` to `questionnaires`.

1. **Write a migration** in `supabase/migrations/000N_your_description.sql`:
   ```sql
   ALTER TABLE public.questionnaires ADD COLUMN due_date TIMESTAMPTZ;
   ```
2. **Apply it** (local or remote):
   ```bash
   supabase db push --db-url "postgresql://postgres.lfmmjjozvxctepedjmjw:...@aws-1-us-west-2.pooler.supabase.com:5432/postgres"
   ```
3. **Regenerate types:**
   ```bash
   npx supabase gen types typescript --project-id lfmmjjozvxctepedjmjw > lib/supabase/types.ts
   ```
   Then **manually re-add** `Relationships: [...]` to every table in the generated file —
   the generator omits these and Supabase v2.108 needs them.
4. **Update API route** `app/api/questionnaires/route.ts` — add field to the insert payload
   and/or the GET select projection.
5. **Update UI** — `app/dashboard/new/page.tsx` (form field) and/or `app/dashboard/page.tsx`
   (display).
6. **Run `npm run type-check`** — fix any errors before committing.

---

## Workflow 2 — Add a new answer type or gap classification

This is a high-blast-radius change. Touch all eight locations or the app will be inconsistent.

1. **Migration** — update the CHECK constraint on `answers.answer_type`:
   ```sql
   ALTER TABLE public.answers DROP CONSTRAINT answers_answer_type_check;
   ALTER TABLE public.answers ADD CONSTRAINT answers_answer_type_check
     CHECK (answer_type IN ('grounded','gap_standard','gap_nda','gap_in_progress','your_new_type'));
   ```
2. **`lib/constants.ts`**
   - Add to `AnswerType` union type.
   - If it's a gap: add to `GAP_ANSWER_TYPES` array.
   - If it maps to a review reason: add to `ROUTE_REASON_BY_TYPE`.
   - If it needs a new placeholder string: add to `GAP_PLACEHOLDERS`.
3. **`lib/supabase/types.ts`** — regenerate (see Workflow 1 step 3) or manually add to
   the `answers` Row + Insert union.
4. **`lib/ai/pipeline.ts`**
   - Add to `AnswerSchema` z.enum.
   - Update `resolveDisplayText()` to handle the new type.
   - Confirm `GAP_ANSWER_TYPES.includes()` check covers it if appropriate.
5. **`lib/ai/prompts.ts`** — add a description of the new type to `GROUNDED_ANSWER_SYSTEM`
   so the model knows when to use it.
6. **`components/workspace/AnswerPanel.tsx`** — add entry to `AnswerTypeBadge.labels`.
7. **`components/workspace/QuestionList.tsx`** — add entry to `AnswerTypeDot.colors`.
8. **Run `npm run type-check`.**

---

## Workflow 3 — Add a new API route

Example: `GET /api/kb` to list KB entries.

1. **Create the file** `app/api/kb/route.ts` (or `app/api/kb/[id]/route.ts`).
2. **Auth pattern** — every route must verify the session:
   ```typescript
   const supabase = await createClient()   // from lib/supabase/server
   const { data: { user } } = await supabase.auth.getUser()
   if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
   ```
3. **Admin-only routes** — check role after auth:
   ```typescript
   const profile = await supabase.from('profiles').select('role').eq('id', user.id).single()
   if (profile.data?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
   ```
4. **Use `createClient()` (not `createServiceClient()`) in routes** — RLS applies.
5. **Return shape** — return `NextResponse.json(data)` or `NextResponse.json({ error }, { status })`.
6. **No `params` destructuring shortcut** — Next.js 16 requires params to be awaited:
   ```typescript
   export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
     const { id } = await params
   ```
7. **Run `npm run type-check`.**

---

## Workflow 4 — Change gap placeholder text

The three gap placeholder strings are compliance-controlled. Before changing them, confirm with
DevSecOps (Matt Beard / Dominique Northecide).

1. **`lib/constants.ts`** — edit `GAP_PLACEHOLDERS.standard`, `.nda`, or `.in_progress`.
   This is the only file to change for rendering.
2. **`lib/ai/prompts.ts`** — verify `GROUNDED_ANSWER_SYSTEM` still accurately describes when each
   gap variant applies. The model classifies by name (`gap_nda`, etc.), not by the placeholder text,
   so the prompt descriptions must remain accurate.
3. **Existing answers are not updated automatically.** `answers.answer_text` already stores the
   old rendered text. If you need to backfill:
   ```sql
   UPDATE public.answers
   SET answer_text = 'new placeholder text here'
   WHERE answer_type = 'gap_standard';
   ```
4. **Run `npm run type-check`.**

---

## Workflow 5 — Add a new Inngest background function

Example: a nightly KB staleness check.

1. **Create** `inngest/functions/your-function.ts`:
   ```typescript
   import { inngest } from '@/inngest/client'

   export const yourFunction = inngest.createFunction(
     { id: 'your-function', name: 'Your Function', triggers: [{ event: 'your/event' }], retries: 2 },
     async ({ event, step }) => {
       await step.run('step-name', async () => { /* ... */ })
     },
   )
   ```
   Inngest v4 uses the **two-argument form** — `createFunction(config, handler)`. No three-arg form.
2. **Add the event type** to `inngest/client.ts → Events`:
   ```typescript
   'your/event': { data: { field: string } }
   ```
3. **Register the function** in `app/api/inngest/route.ts`:
   ```typescript
   import { yourFunction } from '@/inngest/functions/your-function'
   export const { GET, POST, PUT } = serve({ client: inngest, functions: [..., yourFunction] })
   ```
4. **Fire the event** from a route or another function:
   ```typescript
   await inngest.send({ name: 'your/event', data: { field: 'value' } })
   ```
5. **Sync with Inngest** after deploying — in the Inngest dashboard, re-sync your app URL
   (`https://your-domain/api/inngest`) so it discovers the new function.
6. **Run `npm run type-check`.**

---

## Workflow 6 — Re-seed or update the knowledge base

```bash
# Full import from a new Excel file
SEED_USER_ID=bbfa9d31-9399-4b08-87f0-449d51fb6ca3 npm run import-kb path/to/AnswerBank.xlsx
```

The importer (`scripts/import-kb.ts`):
- Fuzzy-matches column headers: Domain, Question, Answer, Source Citation, Sensitivity Tier, Confidence, Internal Notes.
- Skips rows where the Answer starts with the standard gap placeholder text.
- Embeds all questions via Voyage AI in batches of 96.
- Inserts in batches of 50; sets `status = 'approved'` and `approved_by = SEED_USER_ID`.
- Is **not idempotent** — re-running will create duplicate entries. Clear the table first if re-seeding from scratch:
  ```sql
  TRUNCATE public.kb_entries;
  ```
