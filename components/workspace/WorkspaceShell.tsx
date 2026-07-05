'use client'

import { useState, useCallback, useEffect } from 'react'
import { QuestionList } from './QuestionList'
import { AnswerPanel } from './AnswerPanel'
import type { Database } from '@/lib/supabase/types'

type Answer = Database['public']['Tables']['answers']['Row']
type Question = Database['public']['Tables']['questions']['Row'] & {
  answers: Answer[]
}
type Questionnaire = Database['public']['Tables']['questionnaires']['Row'] & {
  questions: Question[]
}

interface Props {
  questionnaire: Questionnaire
  userRole:      'rep' | 'admin'
}

export function WorkspaceShell({ questionnaire, userRole }: Props) {
  const [questions, setQuestions]         = useState(questionnaire.questions ?? [])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isPollling, setIsPolling]        = useState(
    questionnaire.status === 'processing' || questionnaire.status === 'answering',
  )

  // Poll for updates while job is running
  useEffect(() => {
    if (!isPollling) return

    const interval = setInterval(async () => {
      const res  = await fetch(`/api/questionnaires/${questionnaire.id}`)
      const data = await res.json()
      setQuestions(data.questions ?? [])
      if (data.status === 'complete' || data.status === 'failed') {
        setIsPolling(false)
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [isPollling, questionnaire.id])

  // j/k keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'j') setSelectedIndex((i) => Math.min(i + 1, questions.length - 1))
      if (e.key === 'k') setSelectedIndex((i) => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [questions.length])

  const handleAnswerUpdate = useCallback((questionId: string, updatedAnswer: Answer) => {
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === questionId
          ? { ...q, answers: q.answers.map((a) => (a.id === updatedAnswer.id ? updatedAnswer : a)) }
          : q,
      ),
    )
  }, [])

  const selectedQuestion = questions[selectedIndex]

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left — question list */}
      <div className="w-72 shrink-0 flex flex-col border-r border-zinc-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-900">
          <p className="text-sm font-medium text-white truncate">{questionnaire.name}</p>
          {questionnaire.customer && (
            <p className="text-xs text-zinc-500 mt-0.5">{questionnaire.customer}</p>
          )}
          {isPollling && (
            <div className="flex items-center gap-1.5 mt-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-xs text-zinc-500">Processing…</span>
            </div>
          )}
        </div>

        <QuestionList
          questions={questions}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
        />
      </div>

      {/* Right — answer panel */}
      <div className="flex-1 overflow-hidden">
        {selectedQuestion ? (
          <AnswerPanel
            question={selectedQuestion}
            userRole={userRole}
            onUpdate={(answer) => handleAnswerUpdate(selectedQuestion.id, answer)}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            {questions.length === 0
              ? 'No questions extracted yet — processing your file.'
              : 'Select a question to view its answer.'}
          </div>
        )}
      </div>
    </div>
  )
}
