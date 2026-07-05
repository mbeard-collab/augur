import { inngest } from '@/inngest/client'
import { createServiceClient } from '@/lib/supabase/server'
import { extractQuestionsFromExcel } from '@/lib/excel/reader'

export const processQuestionnaire = inngest.createFunction(
  {
    id:          'process-questionnaire',
    name:        'Process Questionnaire Upload',
    triggers:    [{ event: 'questionnaire/uploaded' }],
    concurrency: { limit: 3 },
    retries:     2,
  },
  async ({ event, step }) => {
    const { questionnaire_id, uploaded_by } = event.data as { questionnaire_id: string; uploaded_by: string }
    const supabase = createServiceClient()

    await step.run('mark-processing', async () => {
      await supabase
        .from('questionnaires')
        .update({ status: 'processing' })
        .eq('id', questionnaire_id)
    })

    const questionnaire = await step.run('fetch-questionnaire', async () => {
      const { data, error } = await supabase
        .from('questionnaires')
        .select('*')
        .eq('id', questionnaire_id)
        .single()
      if (error) throw new Error(error.message)
      return data
    })

    const questions = await step.run('extract-questions', async () => {
      if (questionnaire.source_format === 'paste') {
        const { data } = await supabase
          .from('questions')
          .select('id, raw_text')
          .eq('questionnaire_id', questionnaire_id)
          .order('sequence_index')
        return data ?? []
      }

      if (!questionnaire.file_path) throw new Error('No file_path on questionnaire')

      const { data: fileData, error: fileError } = await supabase
        .storage
        .from('augur')
        .download(questionnaire.file_path)
      if (fileError) throw new Error(fileError.message)

      const extracted = await extractQuestionsFromExcel(await fileData.arrayBuffer())

      const { data: inserted, error: insertError } = await supabase
        .from('questions')
        .insert(
          extracted.map((q) => ({
            questionnaire_id,
            raw_text:       q.raw_text,
            location_ref:   q.location_ref,
            sequence_index: q.sequence_index,
          })),
        )
        .select('id, raw_text')
      if (insertError) throw new Error(insertError.message)
      return inserted ?? []
    })

    const uploaderRole = await step.run('update-progress', async () => {
      const profile = await supabase
        .from('profiles')
        .select('role')
        .eq('id', uploaded_by)
        .single()

      await supabase
        .from('questionnaires')
        .update({
          status:   'answering',
          progress: { total: questions.length, answered: 0, routed: 0 },
        })
        .eq('id', questionnaire_id)

      return profile.data?.role ?? 'rep'
    })

    await step.sendEvent(
      'fan-out-questions',
      questions.map((q: { id: string; raw_text: string }) => ({
        name: 'question/answer' as const,
        data: {
          question_id:      q.id,
          questionnaire_id,
          raw_text:         q.raw_text,
          uploader_role:    uploaderRole as 'rep' | 'admin',
        },
      })),
    )

    return { questionnaire_id, question_count: questions.length }
  },
)
