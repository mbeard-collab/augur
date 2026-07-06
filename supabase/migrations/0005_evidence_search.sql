-- ─────────────────────────────────────────────
-- EVIDENCE DOCS SEARCH (pgvector semantic only)
-- Called alongside hybrid_search in lib/search.ts to provide policy-doc
-- context to the AI pipeline.  Reranking happens in the app layer.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_evidence_docs(
  query_embedding  VECTOR(1024),
  match_count      INT     DEFAULT 8
)
RETURNS TABLE (
  id          UUID,
  title       TEXT,
  section     TEXT,
  content     TEXT,
  source_url  TEXT,
  nda_gated   BOOLEAN,
  similarity  FLOAT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    id,
    title,
    section,
    content,
    source_url,
    nda_gated,
    1 - (embedding <=> query_embedding) AS similarity
  FROM public.evidence_docs
  WHERE embedding IS NOT NULL
    AND (NOT nda_gated OR public.get_user_role() = 'admin')
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
