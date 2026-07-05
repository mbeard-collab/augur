import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'
import { GROUNDED_ANSWER_SYSTEM } from './prompts'
import {
  GAP_PLACEHOLDERS,
  GAP_ANSWER_TYPES,
  ROUTE_REASON_BY_TYPE,
  type AnswerType,
  type Confidence,
  type Tier,
  type ReviewReason,
} from '@/lib/constants'
import { hybridSearch, type SearchResult } from '@/lib/search'
import type { Citation } from '@/lib/supabase/types'

// ─────────────────────────────────────────────
// Schema the model must return
// ─────────────────────────────────────────────
const AnswerSchema = z.object({
  answer_type: z.enum(['grounded', 'gap_standard', 'gap_nda', 'gap_in_progress'])
    .describe('Classification of the answer'),
  answer_text: z.string().nullable()
    .describe('The answer text for grounded answers; null for gap variants'),
  confidence: z.enum(['high', 'medium', 'gap']),
  tier: z.enum(['public', 'public_review', 'nda_gated']),
  citations: z.array(z.object({
    kb_entry_id:     z.string().optional(),
    evidence_doc_id: z.string().optional(),
    title:           z.string(),
    section:         z.string().optional(),
    relevance:       z.string().describe('How this citation supports the answer'),
  })),
  reasoning: z.string().describe('Internal reasoning — not shown to users'),
})

export type PipelineResult = {
  answer_type:         AnswerType
  answer_text:         string | null          // raw model answer (null for gaps)
  display_text:        string                 // what to show reps (may be a placeholder)
  confidence:          Confidence
  tier:                Tier
  citations:           Citation[]
  routed_to_devsecops: boolean
  route_reason:        ReviewReason | null
  retrieval_ids:       string[]               // kb_entry ids that were retrieved
  model_used:          string
}

// ─────────────────────────────────────────────
// Main entry point — called once per question
// ─────────────────────────────────────────────
export async function generateGroundedAnswer(
  question:  string,
  userRole:  'rep' | 'admin',
  useOpus = false,                            // promote to Opus for hard/novel questions
): Promise<PipelineResult> {
  // 1. Retrieve + rerank
  const candidates = await hybridSearch(question)

  // 2. Build context block (model never sees embeddings or rrf_score)
  const context = buildContextBlock(candidates)

  // 3. Call Claude (prompt-cached system prompt + KB context)
  const modelId = useOpus ? 'claude-opus-4-8' : 'claude-sonnet-4-6'

  const { object } = await generateObject({
    model:       anthropic(modelId),
    schema:      AnswerSchema,
    system:      GROUNDED_ANSWER_SYSTEM,
    prompt:      `APPROVED CONTEXT:\n${context}\n\nQUESTION:\n${question}`,
    temperature: 0,
  })

  // 4. Resolve display text — the app owns placeholder rendering, not the model
  const displayText = resolveDisplayText(object.answer_type, object.answer_text, object.tier, userRole)

  // 5. Route determination
  const isGap         = GAP_ANSWER_TYPES.includes(object.answer_type as AnswerType)
  const isLowConf     = object.confidence === 'medium' && !isGap
  const shouldRoute   = isGap || isLowConf
  const routeReason   = isGap
    ? ROUTE_REASON_BY_TYPE[object.answer_type] ?? 'no_match'
    : isLowConf ? 'low_confidence' : null

  return {
    answer_type:         object.answer_type as AnswerType,
    answer_text:         object.answer_text,
    display_text:        displayText,
    confidence:          object.confidence as Confidence,
    tier:                object.tier as Tier,
    citations:           object.citations as Citation[],
    routed_to_devsecops: shouldRoute,
    route_reason:        routeReason as ReviewReason | null,
    retrieval_ids:       candidates.map((c) => c.id),
    model_used:          modelId,
  }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function buildContextBlock(candidates: SearchResult[]): string {
  if (candidates.length === 0) return '(No approved KB entries matched this question.)'
  return candidates.map((c, i) => `\
[ENTRY ${i + 1}]
ID: ${c.id}
Domain: ${c.domain}
Tier: ${c.tier}
Question: ${c.question}
Answer: ${c.answer}
`).join('\n---\n')
}

function resolveDisplayText(
  answerType: string,
  answerText: string | null,
  tier:       string,
  userRole:   'rep' | 'admin',
): string {
  if (answerType === 'gap_nda')          return GAP_PLACEHOLDERS.nda
  if (answerType === 'gap_in_progress')  return GAP_PLACEHOLDERS.in_progress
  if (answerType === 'gap_standard')     return GAP_PLACEHOLDERS.standard

  // Grounded — but NDA tier seen by a rep gets the placeholder
  if (tier === 'nda_gated' && userRole === 'rep') return GAP_PLACEHOLDERS.nda

  return answerText ?? GAP_PLACEHOLDERS.standard
}
