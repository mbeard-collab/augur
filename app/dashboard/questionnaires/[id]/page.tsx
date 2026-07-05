import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell'

type Params = { params: Promise<{ id: string }> }

export default async function QuestionnairePage({ params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const [profileResult, questionnaireResult] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).single(),
    supabase
      .from('questionnaires')
      .select(`
        id, name, customer, status, progress, source_format, created_at,
        questions (
          id, raw_text, location_ref, sequence_index,
          answers (
            id, answer_text, answer_type, citations, confidence, tier,
            status, source, routed_to_devsecops, created_at, updated_at
          )
        )
      `)
      .eq('id', id)
      .order('sequence_index', { referencedTable: 'questions', ascending: true })
      .single(),
  ])

  if (questionnaireResult.error) redirect('/dashboard')

  const questionnaire = questionnaireResult.data
  const role          = profileResult.data?.role ?? 'rep'

  return (
    <WorkspaceShell
      questionnaire={questionnaire as Parameters<typeof WorkspaceShell>[0]['questionnaire']}
      userRole={role as 'rep' | 'admin'}
    />
  )
}
