'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/types'

type KBEntry = Pick<
  Database['public']['Tables']['kb_entries']['Row'],
  'id' | 'domain' | 'question' | 'answer' | 'tier' | 'confidence' | 'status' | 'internal_notes' | 'created_at'
>

const TIER_LABELS: Record<string, string> = {
  public:        'Public',
  public_review: 'Review',
  nda_gated:     'NDA',
}

const TIER_STYLES: Record<string, string> = {
  public:        'bg-emerald-950/50 text-emerald-400',
  public_review: 'bg-amber-950/50 text-amber-400',
  nda_gated:     'bg-red-950/50 text-red-400',
}

export default function KBPage() {
  const [entries, setEntries]   = useState<KBEntry[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [domain, setDomain]     = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('kb_entries')
        .select('id, domain, question, answer, tier, confidence, status, internal_notes, created_at')
        .eq('status', 'approved')
        .order('domain')
        .limit(2000)
      setEntries(data ?? [])
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const domains = Array.from(new Set(entries.map(e => e.domain))).sort()

  const filtered = entries.filter(e => {
    if (domain && e.domain !== domain) return false
    if (search) {
      const q = search.toLowerCase()
      return e.question.toLowerCase().includes(q) || e.answer.toLowerCase().includes(q)
    }
    return true
  })

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-white">Knowledge Base</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              {loading ? 'Loading…' : `${entries.length} approved entries`}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search questions and answers…"
            className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-600"
          />
          <select
            value={domain}
            onChange={e => setDomain(e.target.value)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-300 outline-none focus:border-zinc-600"
          >
            <option value="">All domains</option>
            {domains.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        {/* Stats strip */}
        {!loading && entries.length > 0 && (
          <div className="flex gap-4 text-xs text-zinc-500 mb-4">
            <span>{filtered.length} shown</span>
            <span>{domains.length} domains</span>
            <span>{entries.filter(e => e.tier === 'nda_gated').length} NDA-gated</span>
          </div>
        )}

        {/* Entry list */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-5 h-5 border-2 border-zinc-800 border-t-zinc-500 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24 text-sm text-zinc-600">
            {entries.length === 0 ? 'No entries in the knowledge base yet.' : 'No entries match your search.'}
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map(entry => (
              <div
                key={entry.id}
                className="rounded-lg border border-zinc-900 bg-zinc-950 overflow-hidden"
              >
                <button
                  className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-zinc-900 transition-colors"
                  onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs text-zinc-600 font-medium uppercase tracking-wide">
                        {entry.domain}
                      </span>
                      <span className={`rounded-full px-1.5 py-0 text-xs font-medium ${TIER_STYLES[entry.tier] ?? ''}`}>
                        {TIER_LABELS[entry.tier] ?? entry.tier}
                      </span>
                    </div>
                    <p className="text-sm text-white leading-snug">
                      {entry.question}
                    </p>
                    {expanded !== entry.id && (
                      <p className="text-xs text-zinc-500 mt-1 line-clamp-1">
                        {entry.answer}
                      </p>
                    )}
                  </div>
                  <span className="text-zinc-700 mt-0.5 text-xs shrink-0">
                    {expanded === entry.id ? '▲' : '▼'}
                  </span>
                </button>

                {expanded === entry.id && (
                  <div className="px-4 pb-4 border-t border-zinc-900">
                    <p className="text-sm text-zinc-300 mt-3 leading-relaxed whitespace-pre-wrap">
                      {entry.answer}
                    </p>
                    {entry.internal_notes && (() => {
                      try {
                        const notes = JSON.parse(
                          entry.internal_notes.includes('|||')
                            ? entry.internal_notes.split('|||')[0]
                            : entry.internal_notes
                        )
                        if (notes.drive_id) {
                          return (
                            <a
                              href={`https://drive.google.com/file/d/${notes.drive_id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-block mt-3 text-xs text-zinc-600 hover:text-zinc-400 underline underline-offset-2"
                            >
                              Source: {notes.drive_name}
                            </a>
                          )
                        }
                      } catch {}
                      return null
                    })()}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
