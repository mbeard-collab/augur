-- Enable RLS on all tables
ALTER TABLE public.profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questionnaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_queue  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log     ENABLE ROW LEVEL SECURITY;

-- Helper: current user's role (SECURITY DEFINER so RLS policies can call it)
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- ─────────────────────────────────────────────
-- PROFILES
-- ─────────────────────────────────────────────
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT
  USING (id = auth.uid() OR public.get_user_role() = 'admin');

CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE
  USING (id = auth.uid());

-- ─────────────────────────────────────────────
-- EVIDENCE DOCS
-- ─────────────────────────────────────────────
CREATE POLICY "evidence_docs_select" ON public.evidence_docs FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (nda_gated = FALSE OR public.get_user_role() = 'admin')
  );

CREATE POLICY "evidence_docs_all_admin" ON public.evidence_docs FOR ALL
  USING (public.get_user_role() = 'admin');

-- ─────────────────────────────────────────────
-- KB ENTRIES
-- Reps: only approved, non-NDA entries
-- Admins: all entries
-- ─────────────────────────────────────────────
CREATE POLICY "kb_entries_select_rep" ON public.kb_entries FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      (status = 'approved' AND tier IN ('public', 'public_review'))
      OR public.get_user_role() = 'admin'
    )
  );

CREATE POLICY "kb_entries_all_admin" ON public.kb_entries FOR ALL
  USING (public.get_user_role() = 'admin');

-- ─────────────────────────────────────────────
-- QUESTIONNAIRES
-- ─────────────────────────────────────────────
CREATE POLICY "questionnaires_insert" ON public.questionnaires FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND uploaded_by = auth.uid());

CREATE POLICY "questionnaires_select" ON public.questionnaires FOR SELECT
  USING (uploaded_by = auth.uid() OR public.get_user_role() = 'admin');

CREATE POLICY "questionnaires_update" ON public.questionnaires FOR UPDATE
  USING (uploaded_by = auth.uid() OR public.get_user_role() = 'admin');

-- ─────────────────────────────────────────────
-- QUESTIONS (inherits access from questionnaires)
-- ─────────────────────────────────────────────
CREATE POLICY "questions_select" ON public.questions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.questionnaires q
      WHERE q.id = questionnaire_id
        AND (q.uploaded_by = auth.uid() OR public.get_user_role() = 'admin')
    )
  );

CREATE POLICY "questions_insert" ON public.questions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.questionnaires q
      WHERE q.id = questionnaire_id
        AND (q.uploaded_by = auth.uid() OR public.get_user_role() = 'admin')
    )
  );

-- ─────────────────────────────────────────────
-- ANSWERS
-- ─────────────────────────────────────────────
CREATE POLICY "answers_select" ON public.answers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.questions qu
      JOIN public.questionnaires qn ON qn.id = qu.questionnaire_id
      WHERE qu.id = question_id
        AND (qn.uploaded_by = auth.uid() OR public.get_user_role() = 'admin')
    )
  );

CREATE POLICY "answers_update" ON public.answers FOR UPDATE
  USING (
    public.get_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.questions qu
      JOIN public.questionnaires qn ON qn.id = qu.questionnaire_id
      WHERE qu.id = question_id AND qn.uploaded_by = auth.uid()
    )
  );

-- ─────────────────────────────────────────────
-- REVIEW QUEUE
-- Admins: full access. Reps: read-only for their items.
-- ─────────────────────────────────────────────
CREATE POLICY "review_queue_select" ON public.review_queue FOR SELECT
  USING (
    public.get_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.answers a
      JOIN public.questions qu ON qu.id = a.question_id
      JOIN public.questionnaires qn ON qn.id = qu.questionnaire_id
      WHERE a.id = answer_id AND qn.uploaded_by = auth.uid()
    )
  );

CREATE POLICY "review_queue_all_admin" ON public.review_queue FOR ALL
  USING (public.get_user_role() = 'admin');

-- ─────────────────────────────────────────────
-- AUDIT LOG (append-only; actors see their own, admins see all)
-- ─────────────────────────────────────────────
CREATE POLICY "audit_log_select" ON public.audit_log FOR SELECT
  USING (actor_id = auth.uid() OR public.get_user_role() = 'admin');

CREATE POLICY "audit_log_insert" ON public.audit_log FOR INSERT
  WITH CHECK (actor_id = auth.uid());
