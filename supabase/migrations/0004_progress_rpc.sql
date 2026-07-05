-- Atomic JSONB counter increment for questionnaire progress
-- Called by the answer-question Inngest function after each answer is written.
CREATE OR REPLACE FUNCTION public.increment_progress(
  p_questionnaire_id UUID,
  p_routed           BOOLEAN DEFAULT FALSE
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.questionnaires
  SET
    progress = jsonb_set(
      jsonb_set(
        progress,
        '{answered}',
        to_jsonb((progress->>'answered')::int + 1)
      ),
      '{routed}',
      to_jsonb((progress->>'routed')::int + CASE WHEN p_routed THEN 1 ELSE 0 END)
    ),
    status = CASE
      WHEN ((progress->>'answered')::int + 1) >= (progress->>'total')::int
        THEN 'complete'
      ELSE status
    END
  WHERE id = p_questionnaire_id;
END;
$$;
