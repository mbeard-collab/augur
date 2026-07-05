'use client'

import { useRef, useEffect } from 'react'
import type { Database } from '@/lib/supabase/types'

type Answer   = Database['public']['Tables']['answers']['Row']
type Question = Database['public']['Tables']['questions']['Row'] & { answers: Answer[] }

interface Props {
  questions:     Question[]
  selectedIndex: number
  onSelect:      (index: number) => void
}

export function QuestionList({ questions, selectedIndex, onSelect }: Props) {
  const selectedRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedIndex])

  if (!questions.length) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-xs text-zinc-600 text-center">Extracting questions…</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto py-1">
      {questions.map((q, i) => {
        const answer   = q.answers?.[0]
        const isActive = i === selectedIndex

        return (
          <button
            key={q.id}
            ref={isActive ? selectedRef : undefined}
            onClick={() => onSelect(i)}
            className={`w-full text-left px-4 py-3 border-b border-zinc-900/50 transition-colors ${
              isActive ? 'bg-zinc-900' : 'hover:bg-zinc-950'
            }`}
          >
            <div className="flex items-start gap-2">
              <span className="text-xs text-zinc-700 tabular-nums mt-0.5 shrink-0 w-5">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-300 leading-relaxed line-clamp-2">
                  {q.raw_text}
                </p>
                {answer && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <AnswerTypeDot type={answer.answer_type} />
                    <ConfidenceChip confidence={answer.confidence} />
                    {answer.routed_to_devsecops && (
                      <span className="text-[10px] text-amber-500">routed</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function AnswerTypeDot({ type }: { type: string }) {
  const colors: Record<string, string> = {
    grounded:         'bg-emerald-500',
    gap_standard:     'bg-red-500',
    gap_nda:          'bg-amber-500',
    gap_in_progress:  'bg-amber-500',
  }
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-0.5 ${colors[type] ?? 'bg-zinc-600'}`} />
}

function ConfidenceChip({ confidence }: { confidence: string }) {
  const styles: Record<string, string> = {
    high:   'text-emerald-500',
    medium: 'text-amber-500',
    gap:    'text-red-500',
  }
  return <span className={`text-[10px] font-medium ${styles[confidence] ?? 'text-zinc-500'}`}>{confidence}</span>
}
