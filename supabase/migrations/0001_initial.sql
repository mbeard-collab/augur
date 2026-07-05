-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─────────────────────────────────────────────
-- PROFILES
-- ─────────────────────────────────────────────
CREATE TABLE public.profiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'rep' CHECK (role IN ('rep', 'admin')),
  full_name   TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- EVIDENCE DOCUMENTS (source policies for grounding)
-- ─────────────────────────────────────────────
CREATE TABLE public.evidence_docs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       TEXT NOT NULL,
  section     TEXT,
  content     TEXT NOT NULL,
  embedding   VECTOR(1024),                  -- voyage-3-large dims
  tsv         TSVECTOR GENERATED ALWAYS AS (
                to_tsvector('english', coalesce(title,'') || ' ' || coalesce(section,'') || ' ' || content)
              ) STORED,
  nda_gated   BOOLEAN NOT NULL DEFAULT FALSE,
  source_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- KNOWLEDGE BASE ENTRIES (canonical answer bank)
-- ─────────────────────────────────────────────
CREATE TABLE public.kb_entries (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  domain         TEXT NOT NULL,
  question       TEXT NOT NULL,
  answer         TEXT NOT NULL,
  citations      JSONB NOT NULL DEFAULT '[]'::jsonb,
  tier           TEXT NOT NULL DEFAULT 'public'
                   CHECK (tier IN ('public', 'public_review', 'nda_gated')),
  confidence     TEXT NOT NULL DEFAULT 'high'
                   CHECK (confidence IN ('high', 'medium', 'gap')),
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected', 'archived')),
  embedding      VECTOR(1024),
  question_tsv   TSVECTOR GENERATED ALWAYS AS (
                   to_tsvector('english', question)
                 ) STORED,
  internal_notes TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  approved_by    UUID REFERENCES public.profiles(id),
  approved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- QUESTIONNAIRES (an upload / processing job)
-- ─────────────────────────────────────────────
CREATE TABLE public.questionnaires (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT NOT NULL,
  customer         TEXT,
  source_format    TEXT NOT NULL
                     CHECK (source_format IN ('excel', 'word', 'pdf', 'paste', 'portal')),
  file_path        TEXT,                     -- Supabase Storage object path
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'processing', 'answering', 'complete', 'failed')),
  progress         JSONB NOT NULL DEFAULT '{"total":0,"answered":0,"routed":0}'::jsonb,
  inngest_event_id TEXT,
  error_message    TEXT,
  uploaded_by      UUID REFERENCES public.profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- QUESTIONS (extracted from a questionnaire)
-- ─────────────────────────────────────────────
CREATE TABLE public.questions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  questionnaire_id UUID NOT NULL REFERENCES public.questionnaires(id) ON DELETE CASCADE,
  raw_text         TEXT NOT NULL,
  normalized_text  TEXT,
  location_ref     TEXT,                     -- e.g. "Sheet1!B5" or "para:12"
  sequence_index   INTEGER NOT NULL,
  dedupe_group     UUID,                     -- groups near-identical questions
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- ANSWERS (drafted response per question)
-- ─────────────────────────────────────────────
CREATE TABLE public.answers (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id          UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  kb_entry_id          UUID REFERENCES public.kb_entries(id),
  answer_text          TEXT NOT NULL,
  answer_type          TEXT NOT NULL
                         CHECK (answer_type IN ('grounded', 'gap_standard', 'gap_nda', 'gap_in_progress')),
  citations            JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence           TEXT NOT NULL
                         CHECK (confidence IN ('high', 'medium', 'gap')),
  tier                 TEXT NOT NULL
                         CHECK (tier IN ('public', 'public_review', 'nda_gated')),
  status               TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected')),
  source               TEXT NOT NULL DEFAULT 'ai'
                         CHECK (source IN ('ai', 'kb', 'human')),
  routed_to_devsecops  BOOLEAN NOT NULL DEFAULT FALSE,
  generation_metadata  JSONB DEFAULT '{}'::jsonb,  -- model, tokens, latency
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- REVIEW QUEUE (DevSecOps work items)
-- ─────────────────────────────────────────────
CREATE TABLE public.review_queue (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  answer_id  UUID NOT NULL REFERENCES public.answers(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL
               CHECK (reason IN ('low_confidence','no_match','nda_gated','in_progress','edited','manual')),
  assignee   UUID REFERENCES public.profiles(id),
  status     TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','in_review','resolved','dismissed')),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- AUDIT LOG (immutable, append-only)
-- ─────────────────────────────────────────────
CREATE TABLE public.audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id    UUID NOT NULL REFERENCES public.profiles(id),
  action      TEXT NOT NULL,           -- 'generate','approve','reject','edit','route','export','kb_import'
  entity_type TEXT NOT NULL,           -- 'answer','kb_entry','questionnaire'
  entity_id   UUID NOT NULL,
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
CREATE INDEX kb_entries_embedding_idx      ON public.kb_entries USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX kb_entries_tsv_idx            ON public.kb_entries USING gin (question_tsv);
CREATE INDEX kb_entries_status_tier_idx    ON public.kb_entries (status, tier);

CREATE INDEX evidence_docs_embedding_idx   ON public.evidence_docs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX evidence_docs_tsv_idx         ON public.evidence_docs USING gin (tsv);

CREATE INDEX questions_questionnaire_idx   ON public.questions (questionnaire_id, sequence_index);
CREATE INDEX answers_question_idx          ON public.answers (question_id);
CREATE INDEX answers_status_idx            ON public.answers (status);
CREATE INDEX review_queue_status_idx       ON public.review_queue (status, assignee);
CREATE INDEX audit_log_entity_idx          ON public.audit_log (entity_type, entity_id);
CREATE INDEX audit_log_actor_idx           ON public.audit_log (actor_id, created_at DESC);
