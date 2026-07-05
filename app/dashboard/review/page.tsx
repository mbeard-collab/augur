import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { formatDistanceToNow } from '@/lib/utils'

export default async function ReviewQueuePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const profile = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile.data?.role !== 'admin') redirect('/dashboard')

  const { data: items } = await supabase
    .from('review_queue')
    .select(`
      id, reason, status, notes, created_at,
      answers (
        id, answer_text, answer_type, confidence, tier, status,
        questions (
          id, raw_text, questionnaire_id,
          questionnaires ( id, name, customer )
        )
      )
    `)
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(100)

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-semibold text-white">Review Queue</h1>
            <p className="text-sm text-zinc-500 mt-1">
              {items?.length ?? 0} open item{items?.length === 1 ? '' : 's'} awaiting review
            </p>
          </div>
        </div>

        {!items?.length ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-8 h-8 rounded-full border border-emerald-900 bg-emerald-950/30 flex items-center justify-center mb-3">
              <span className="text-emerald-500 text-sm">✓</span>
            </div>
            <p className="text-sm text-zinc-400">Queue is clear</p>
            <p className="text-xs text-zinc-600 mt-1">All questions have been reviewed.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const answer       = item.answers as unknown as {
                id: string; answer_text: string; answer_type: string; confidence: string; tier: string; status: string;
                questions: { id: string; raw_text: string; questionnaire_id: string; questionnaires: { id: string; name: string; customer: string | null } }
              }
              const question     = answer?.questions
              const questionnaire = question?.questionnaires

              return (
                <div key={item.id} className="rounded-lg border border-zinc-900 bg-zinc-950 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <ReasonChip reason={item.reason} />
                        <span className="text-xs text-zinc-600">{formatDistanceToNow(item.created_at)}</span>
                      </div>
                      <p className="text-sm text-zinc-200 leading-relaxed line-clamp-2">
                        {question?.raw_text}
                      </p>
                      {questionnaire && (
                        <p className="text-xs text-zinc-600 mt-1">
                          {questionnaire.name}{questionnaire.customer ? ` · ${questionnaire.customer}` : ''}
                        </p>
                      )}
                    </div>
                    {questionnaire && (
                      <Link
                        href={`/dashboard/questionnaires/${questionnaire.id}`}
                        className="shrink-0 rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white"
                      >
                        Review →
                      </Link>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ReasonChip({ reason }: { reason: string }) {
  const styles: Record<string, string> = {
    low_confidence: 'border-amber-900 bg-amber-950/30 text-amber-400',
    no_match:       'border-red-900   bg-red-950/30   text-red-400',
    nda_gated:      'border-purple-900 bg-purple-950/30 text-purple-400',
    in_progress:    'border-blue-900  bg-blue-950/30  text-blue-400',
    edited:         'border-zinc-800  text-zinc-400',
    manual:         'border-zinc-800  text-zinc-400',
  }
  const labels: Record<string, string> = {
    low_confidence: 'Low confidence',
    no_match:       'No match',
    nda_gated:      'NDA-gated',
    in_progress:    'In progress',
    edited:         'Edited',
    manual:         'Manual route',
  }
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${styles[reason] ?? styles.manual}`}>
      {labels[reason] ?? reason}
    </span>
  )
}
