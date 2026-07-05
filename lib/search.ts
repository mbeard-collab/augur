import { createServiceClient } from '@/lib/supabase/server'
import { embedText, rerank, type RerankCandidate } from '@/lib/voyage'
import { HYBRID_MATCH_COUNT, RERANK_TOP_K } from '@/lib/constants'
import type { Json } from '@/lib/supabase/types'

export interface SearchResult extends RerankCandidate {
  id:         string
  domain:     string
  question:   string
  answer:     string
  citations:  Json
  tier:       string
  confidence: string
  rrf_score:  number
  document:   string
}

type RpcRow = {
  id:            string
  domain:        string
  question:      string
  answer:        string
  citations:     Json
  tier:          string
  confidence:    string
  rrf_score:     number
  semantic_rank: number
  keyword_rank:  number
}

export async function hybridSearch(
  query: string,
  topK:  number = RERANK_TOP_K,
): Promise<SearchResult[]> {
  const supabase = createServiceClient()

  const embedding = await embedText(query)

  const { data, error } = await supabase.rpc('hybrid_search', {
    query_embedding: `[${embedding.join(',')}]`,
    query_text:      query,
    match_count:     HYBRID_MATCH_COUNT,
  })

  if (error) throw new Error(`hybrid_search failed: ${error.message}`)
  if (!data || data.length === 0) return []

  const candidates: SearchResult[] = (data as RpcRow[]).map((row) => ({
    id:         row.id,
    domain:     row.domain,
    question:   row.question,
    answer:     row.answer,
    citations:  row.citations,
    tier:       row.tier,
    confidence: row.confidence,
    rrf_score:  row.rrf_score,
    document:   `${row.question}\n\n${row.answer}`,
  }))

  return rerank(query, candidates, topK)
}
