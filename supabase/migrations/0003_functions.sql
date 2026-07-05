-- ─────────────────────────────────────────────
-- HYBRID SEARCH (pgvector + tsvector → RRF → top K)
-- Called from the application; reranking happens in the app layer (Voyage).
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_embedding   VECTOR(1024),
  query_text        TEXT,
  match_count       INT     DEFAULT 20,
  semantic_weight   FLOAT   DEFAULT 0.7,
  keyword_weight    FLOAT   DEFAULT 0.3,
  rrf_k             INT     DEFAULT 60
)
RETURNS TABLE (
  id              UUID,
  domain          TEXT,
  question        TEXT,
  answer          TEXT,
  citations       JSONB,
  tier            TEXT,
  confidence      TEXT,
  rrf_score       FLOAT,
  semantic_rank   INT,
  keyword_rank    INT
)
LANGUAGE SQL STABLE AS $$
  WITH semantic AS (
    SELECT
      id,
      ROW_NUMBER() OVER (ORDER BY embedding <=> query_embedding) AS rank
    FROM public.kb_entries
    WHERE status = 'approved'
      AND embedding IS NOT NULL
      AND (tier != 'nda_gated' OR public.get_user_role() = 'admin')
    ORDER BY embedding <=> query_embedding
    LIMIT match_count * 3
  ),
  keyword AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank(question_tsv, plainto_tsquery('english', query_text)) DESC
      ) AS rank
    FROM public.kb_entries
    WHERE status = 'approved'
      AND question_tsv @@ plainto_tsquery('english', query_text)
      AND (tier != 'nda_gated' OR public.get_user_role() = 'admin')
    ORDER BY ts_rank(question_tsv, plainto_tsquery('english', query_text)) DESC
    LIMIT match_count * 3
  ),
  rrf AS (
    SELECT
      COALESCE(s.id, k.id)                                                       AS id,
      COALESCE(1.0 / (rrf_k + s.rank), 0) * semantic_weight
        + COALESCE(1.0 / (rrf_k + k.rank), 0) * keyword_weight                  AS rrf_score,
      s.rank::INT                                                                 AS semantic_rank,
      k.rank::INT                                                                 AS keyword_rank
    FROM semantic s
    FULL OUTER JOIN keyword k ON s.id = k.id
  )
  SELECT
    kb.id,
    kb.domain,
    kb.question,
    kb.answer,
    kb.citations,
    kb.tier,
    kb.confidence,
    rrf.rrf_score,
    rrf.semantic_rank,
    rrf.keyword_rank
  FROM rrf
  JOIN public.kb_entries kb ON kb.id = rrf.id
  ORDER BY rrf.rrf_score DESC
  LIMIT match_count;
$$;

-- ─────────────────────────────────────────────
-- AUTO-UPDATE updated_at
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER kb_entries_updated_at      BEFORE UPDATE ON public.kb_entries      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER questionnaires_updated_at  BEFORE UPDATE ON public.questionnaires  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER answers_updated_at         BEFORE UPDATE ON public.answers         FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER review_queue_updated_at    BEFORE UPDATE ON public.review_queue    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER profiles_updated_at        BEFORE UPDATE ON public.profiles        FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─────────────────────────────────────────────
-- AUTO-CREATE PROFILE ON SIGNUP
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────
-- KB ENTRY VERSION BUMP ON UPDATE
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bump_kb_version()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.answer IS DISTINCT FROM NEW.answer
     OR OLD.citations IS DISTINCT FROM NEW.citations
     OR OLD.tier IS DISTINCT FROM NEW.tier
  THEN
    NEW.version = OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER kb_entries_version_bump
  BEFORE UPDATE ON public.kb_entries
  FOR EACH ROW EXECUTE FUNCTION public.bump_kb_version();
