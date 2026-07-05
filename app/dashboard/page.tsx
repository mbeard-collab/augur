import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { formatDistanceToNow } from '@/lib/utils'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const profile = await supabase.from('profiles').select('role').eq('id', user!.id).single()
  const isAdmin = profile.data?.role === 'admin'

  const query = supabase
    .from('questionnaires')
    .select('id, name, customer, status, progress, created_at, source_format')
    .order('created_at', { ascending: false })
    .limit(50)

  if (!isAdmin) query.eq('uploaded_by', user!.id)

  const { data: questionnaires } = await query

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-xl font-semibold text-white">Questionnaires</h1>
          <Link
            href="/dashboard/new"
            className="rounded-md bg-[#0070f3] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            New Upload
          </Link>
        </div>

        {!questionnaires?.length ? (
          <EmptyState />
        ) : (
          <div className="space-y-2">
            {questionnaires.map((q) => (
              <Link
                key={q.id}
                href={`/dashboard/questionnaires/${q.id}`}
                className="flex items-center gap-4 rounded-lg border border-zinc-900 bg-zinc-950 px-4 py-3.5 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{q.name}</p>
                  {q.customer && (
                    <p className="text-xs text-zinc-500 mt-0.5">{q.customer}</p>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <ProgressBar progress={q.progress as { total: number; answered: number; routed: number }} />
                  <StatusChip status={q.status} />
                  <span className="text-xs text-zinc-600 w-20 text-right">
                    {formatDistanceToNow(q.created_at)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending:   'bg-zinc-900 text-zinc-400',
    processing:'bg-amber-950/50 text-amber-400',
    answering: 'bg-blue-950/50 text-blue-400',
    complete:  'bg-emerald-950/50 text-emerald-400',
    failed:    'bg-red-950/50 text-red-400',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.pending}`}>
      {status}
    </span>
  )
}

function ProgressBar({ progress }: { progress: { total: number; answered: number; routed: number } }) {
  if (!progress.total) return null
  const pct = Math.round((progress.answered / progress.total) * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-1 bg-zinc-800 rounded-full overflow-hidden">
        <div className="h-full bg-[#0070f3] rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-zinc-500 w-12">{progress.answered}/{progress.total}</span>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-12 h-12 rounded-xl border border-zinc-800 flex items-center justify-center mb-4">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M4 4h12v12H4z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-zinc-600"/>
          <path d="M7 8h6M7 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-zinc-600"/>
        </svg>
      </div>
      <p className="text-sm text-zinc-400 font-medium">No questionnaires yet</p>
      <p className="text-xs text-zinc-600 mt-1 max-w-xs">
        Upload a customer security questionnaire to get started.
      </p>
      <Link
        href="/dashboard/new"
        className="mt-4 rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white"
      >
        Upload questionnaire
      </Link>
    </div>
  )
}
