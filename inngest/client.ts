import { Inngest } from 'inngest'

export const inngest = new Inngest({
  id:   'security-questionnaire',
  name: 'Security Questionnaire',
})

// Typed event map
export type Events = {
  'questionnaire/uploaded': {
    data: {
      questionnaire_id: string
      uploaded_by:      string
    }
  }
  'question/answer': {
    data: {
      question_id:      string
      questionnaire_id: string
      raw_text:         string
      uploader_role:    'rep' | 'admin'
    }
  }
}
