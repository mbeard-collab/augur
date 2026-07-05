import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { processQuestionnaire } from '@/inngest/functions/process-questionnaire'
import { answerQuestion } from '@/inngest/functions/answer-question'

export const { GET, POST, PUT } = serve({
  client:    inngest,
  functions: [processQuestionnaire, answerQuestion],
})
