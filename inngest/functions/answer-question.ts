import { inngest } from '@/inngest/client'
import { createServiceClient } from '@/lib/supabase/server'
import { generateGroundedAnswer } from '@/lib/ai/pipeline'

export const answerQuestion = inngest.createFunction(
  {
    id:          'answer-question',
    name:        'Answer Individual Question',
    triggers:    [{ event: 'question/answer' }],
    concurrency: {
      limit: 5,
      key:   'event.data.questionnaire_id',
    },
    retries: 3,
  },
  async ({ event, step }) => {
    const { question_id, questionnaire_id, raw_text, uploader_role } = event.data as {
      question_id:      string
      questionnaire_id: string
      raw_text:         string
      uploader_role:    'rep' | 'admin'
    }
    const supabase = createServiceClient()

    const result = await step.run('generate-answer', async () => {
      return generateGroundedAnswer(raw_text, uploader_role)
    })

    const answer = await step.run('persist-answer', async () => {
      const { data, error } = await supabase
        .from('answers')
        .insert({
          question_id,
          answer_text:         result.display_text,
          answer_type:         result.answer_type,
          citations:           result.citations,
          confidence:          result.confidence,
          tier:                result.tier,
          status:              result.routed_to_devsecops ? 'pending_review' : 'draft',
          source:              'ai',
          routed_to_devsecops: result.routed_to_devsecops,
          generation_metadata: {
            model:         result.model_used,
            retrieval_ids: result.retrieval_ids,
          },
        })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      return data
    })

    if (result.routed_to_devsecops && result.route_reason) {
      await step.run('queue-for-review', async () => {
        await supabase.from('review_queue').insert({
          answer_id: answer.id,
          reason:    result.route_reason!,
          status:    'open',
        })
      })
    }

    await step.run('update-progress', async () => {
      await supabase.rpc('increment_progress', {
        p_questionnaire_id: questionnaire_id,
        p_routed:           result.routed_to_devsecops,
      })
    })

    await step.run('audit', async () => {
      const { data: q } = await supabase
        .from('questionnaires')
        .select('uploaded_by')
        .eq('id', questionnaire_id)
        .single()

      if (q?.uploaded_by) {
        await supabase.from('audit_log').insert({
          actor_id:    q.uploaded_by,
          action:      'generate',
          entity_type: 'answer',
          entity_id:   answer.id,
          metadata:    { answer_type: result.answer_type, confidence: result.confidence },
        })
      }
    })

    return { question_id, answer_id: answer.id, answer_type: result.answer_type }
  },
)
