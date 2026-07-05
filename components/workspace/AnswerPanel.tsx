'use client'

import { useState } from 'react'
import type { Database, Citation } from '@/lib/supabase/types'
import { GAP_PLACEHOLDERS } from '@/lib/constants'

type Answer   = Database['public']['Tables']['answers']['Row']
type Question = Database['public']['Tables']['questions']['Row'] & { answers: Answer[] }

interface Props {
  question: Question
  userRole: 'rep' | 'admin'
  onUpdate: (answer: Answer) => void
}

export function AnswerPanel({ question, userRole, onUpdate }: Props) {
  const answer    = question.answers?.[0]
  const isAdmin   = userRole === 'admin'
  const [editing, setEditing]     = useState(false)
  const [editText, setEditText]   = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)

  if (!answer) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-5 h-5 border-2 border-zinc-800 border-t-zinc-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-zinc-600">Generating answer…</p>
        </div>
      </div>
    )
  }

  async function act(action: 'approve' | 'reject' | 'route' | 'edit', extraBody?: Record<string, unknown>) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/questionnaires/${answer!.question_id.split('-')[0]}/answers`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ answer_id: answer!.id, action, ...extraBody }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const updated: Answer = { ...answer!, status: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'pending_review' }
      onUpdate(updated)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setLoading(false)
    }
  }

  const isGap      = answer.answer_type !== 'grounded'
  const isApproved = answer.status === 'approved'

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-8 py-8 space-y-6">
        {/* Question */}
        <div>
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-widest mb-2">Question</p>
          <p className="text-sm text-white leading-relaxed">{question.raw_text}</p>
          {question.location_ref && (
            <p className="text-xs text-zinc-700 mt-1">{question.location_ref}</p>
          )}
        </div>

        {/* Metadata chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <ConfidenceBadge confidence={answer.confidence} />
          <TierBadge tier={answer.tier} />
          <AnswerTypeBadge type={answer.answer_type} />
          <StatusBadge status={answer.status} />
          {answer.routed_to_devsecops && (
            <span className="rounded-full border border-amber-800 bg-amber-950/30 px-2 py-0.5 text-xs text-amber-400">
              Routed to DevSecOps
            </span>
          )}
        </div>

        {/* Answer text */}
        <div>
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-widest mb-2">Answer</p>
          {editing ? (
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full h-40 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white resize-none focus:border-[#0070f3] focus:outline-none"
            />
          ) : (
            <div className={`rounded-md border px-4 py-3 text-sm leading-relaxed ${
              isGap
                ? 'border-amber-900/50 bg-amber-950/20 text-amber-200/80 italic'
                : 'border-zinc-800 bg-zinc-950 text-zinc-200'
            }`}>
              {answer.answer_text}
            </div>
          )}
        </div>

        {/* Citations */}
        {!isGap && (answer.citations as unknown as Citation[])?.length > 0 && (
          <div>
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-widest mb-2">Citations</p>
            <div className="space-y-1.5">
              {(answer.citations as unknown as Citation[]).map((cite, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border border-zinc-900 bg-zinc-950 px-3 py-2">
                  <span className="text-xs text-zinc-600 shrink-0 mt-0.5">{i + 1}</span>
                  <div>
                    <p className="text-xs font-medium text-zinc-300">{cite.title}</p>
                    {cite.section && <p className="text-xs text-zinc-500">{cite.section}</p>}
                    <p className="text-xs text-zinc-600 mt-0.5">{cite.relevance}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        {!isApproved && (
          <div className="flex items-center gap-2 pt-2">
            {isAdmin && !isGap && (
              <ActionButton
                onClick={() => act('approve')}
                label="Approve"
                loading={loading}
                primary
              />
            )}

            {isAdmin && editing && (
              <ActionButton
                onClick={() => act('edit', { answer_text: editText })}
                label="Save Edit"
                loading={loading}
                primary
              />
            )}

            {isAdmin && !editing && (
              <ActionButton
                onClick={() => { setEditText(answer.answer_text); setEditing(true) }}
                label="Edit"
                loading={false}
              />
            )}

            {editing && (
              <ActionButton onClick={() => setEditing(false)} label="Cancel" loading={false} />
            )}

            {!answer.routed_to_devsecops && (
              <ActionButton
                onClick={() => act('route')}
                label="Route to DevSecOps"
                loading={loading}
              />
            )}

            {isAdmin && answer.status !== 'rejected' && (
              <ActionButton
                onClick={() => act('reject')}
                label="Reject"
                loading={loading}
                danger
              />
            )}
          </div>
        )}

        {isApproved && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-900/50 bg-emerald-950/20 px-3 py-2">
            <span className="text-xs text-emerald-400">Approved — this answer is canonical</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ActionButton({
  onClick, label, loading, primary, danger,
}: {
  onClick: () => void; label: string; loading: boolean; primary?: boolean; danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        primary
          ? 'bg-[#0070f3] text-white hover:bg-blue-500'
          : danger
          ? 'border border-red-900 text-red-400 hover:bg-red-950/30'
          : 'border border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-white'
      }`}
    >
      {loading ? '…' : label}
    </button>
  )
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const s: Record<string, string> = {
    high:   'border-emerald-900 bg-emerald-950/30 text-emerald-400',
    medium: 'border-amber-900   bg-amber-950/30   text-amber-400',
    gap:    'border-red-900     bg-red-950/30     text-red-400',
  }
  return <Chip label={confidence} style={s[confidence] ?? s.gap} />
}

function TierBadge({ tier }: { tier: string }) {
  const s: Record<string, string> = {
    public:         'border-zinc-800 text-zinc-400',
    public_review:  'border-amber-900 bg-amber-950/30 text-amber-400',
    nda_gated:      'border-red-900   bg-red-950/30   text-red-400',
  }
  const labels: Record<string, string> = {
    public:        'Public',
    public_review: 'Review',
    nda_gated:     'NDA',
  }
  return <Chip label={labels[tier] ?? tier} style={s[tier] ?? s.public} />
}

function AnswerTypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    grounded:        'Grounded',
    gap_standard:    'Gap — Standard',
    gap_nda:         'Gap — NDA',
    gap_in_progress: 'Gap — In Progress',
  }
  return <Chip label={labels[type] ?? type} style="border-zinc-800 text-zinc-500" />
}

function StatusBadge({ status }: { status: string }) {
  const s: Record<string, string> = {
    draft:          'border-zinc-800 text-zinc-500',
    pending_review: 'border-amber-900 bg-amber-950/30 text-amber-400',
    approved:       'border-emerald-900 bg-emerald-950/30 text-emerald-400',
    rejected:       'border-red-900 bg-red-950/30 text-red-400',
  }
  return <Chip label={status.replace('_', ' ')} style={s[status] ?? s.draft} />
}

function Chip({ label, style }: { label: string; style: string }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  )
}
