// Single source of truth for all fixed strings and enums.
// The pipeline classifies into one of these types; the app renders the string — the model never writes placeholders.

export const GAP_PLACEHOLDERS = {
  standard: `This question requires review by GovSpend's DevSecOps team before a response is provided. Please do not answer from another source. Assign this item to DevSecOps (Matt Beard / Dominique Northecide) for a verified answer.`,

  nda: `Available under NDA. GovSpend can share this documentation once a mutual NDA is in place. Please route to DevSecOps to coordinate release.`,

  in_progress: `GovSpend has established a formal Information Security Management System and is currently undergoing SOC 2 certification. For current status, route to DevSecOps.`,
} as const

export type AnswerType = 'grounded' | 'gap_standard' | 'gap_nda' | 'gap_in_progress'
export type Confidence  = 'high' | 'medium' | 'gap'
export type Tier        = 'public' | 'public_review' | 'nda_gated'
export type AnswerStatus = 'draft' | 'pending_review' | 'approved' | 'rejected'
export type UserRole    = 'rep' | 'admin'
export type QuestionnaireStatus = 'pending' | 'processing' | 'answering' | 'complete' | 'failed'
export type ReviewReason = 'low_confidence' | 'no_match' | 'nda_gated' | 'in_progress' | 'edited' | 'manual'

export const CONFIDENCE_THRESHOLDS = {
  high:   0.80,
  medium: 0.50,
} as const

export const STALENESS_MONTHS = 6

// Gap answer types always route to DevSecOps regardless of confidence
export const GAP_ANSWER_TYPES: AnswerType[] = ['gap_standard', 'gap_nda', 'gap_in_progress']

// Route reason by answer type
export const ROUTE_REASON_BY_TYPE: Record<string, ReviewReason> = {
  gap_standard:    'no_match',
  gap_nda:         'nda_gated',
  gap_in_progress: 'in_progress',
}

// Max concurrent Claude calls per Inngest job (stay inside Anthropic rate limits)
export const MAX_CONCURRENT_ANSWERS = 5

// Top-K candidates to pass to Voyage reranker after hybrid search
export const RERANK_TOP_K = 8

// Minimum RRF candidates to retrieve before reranking
export const HYBRID_MATCH_COUNT = 20
