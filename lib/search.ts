import { createServiceClient } from '@/lib/supabase/server'
import { embedText, rerank, type RerankCandidate } from '@/lib/voyage'
import { HYBRID_MATCH_COUNT, RERANK_TOP_K } from '@/lib/constants'
import type { Json } from '@/lib/supabase/types'

export interface SearchResult extends RerankCandidate {
  id:            string
  domain?:       string
  question?:     string
  answer?:       string
  citations?:    Json
  tier?:         string
  confidence?:   string
  rrf_score?:    number
  // evidence_docs fields
  title?:        string
  section?:      string
  content?:      string
  source_url?:   string
  result_type:   'kb_entry' | 'evidence_doc'
  document:      string
}

type KBRow = {
  id: string; domain: string; question: string; answer: string
  citations: Json; tier: string; confidence: string
  rrf_score: number; semantic_rank: number; keyword_rank: number
}

type EvidenceRow = {
  id: string; title: string; section: string | null; content: string
  source_url: string | null; nda_gated: boolean; similarity: number
}

export async function hybridSearch(
  query: string,
  topK:  number = RERANK_TOP_K,
): Promise<SearchResult[]> {
  const supabase = createServiceClient()

  const embedding = await embedText(query)
  const embStr = `[${embedding.join(',')}]`

  // Run kb_entries and evidence_docs searches in parallel
  const [kbResult, evResult] = await Promise.all([
    supabase.rpc('hybrid_search', {
      query_embedding: embStr,
      query_text:      query,
      match_count:     HYBRID_MATCH_COUNT,
    }),
    supabase.rpc('search_evidence_docs', {
      query_embedding: embStr,
      match_count:     8,
    }),
  ])

  if (kbResult.error) throw new Error(`hybrid_search failed: ${kbResult.error.message}`)

  const kbCandidates: SearchResult[] = ((kbResult.data ?? []) as KBRow[]).map((row) => ({
    id:          row.id,
    domain:      row.domain,
    question:    row.question,
    answer:      row.answer,
    citations:   row.citations,
    tier:        row.tier,
    confidence:  row.confidence,
    rrf_score:   row.rrf_score,
    result_type: 'kb_entry',
    document:    `${row.question}\n\n${row.answer}`,
  }))

  // evidence_docs are optional — silently skip if RPC not yet deployed
  const evCandidates: SearchResult[] = evResult.error
    ? []
    : ((evResult.data ?? []) as EvidenceRow[]).map((row) => ({
        id:          row.id,
        title:       row.title,
        section:     row.section ?? undefined,
        content:     row.content,
        source_url:  row.source_url ?? undefined,
        result_type: 'evidence_doc',
        document:    `${row.title}${row.section ? ` — ${row.section}` : ''}\n\n${row.content}`,
      }))

  if (kbCandidates.length === 0 && evCandidates.length === 0) return []

  return rerank(query, [...kbCandidates, ...evCandidates], topK)
}
