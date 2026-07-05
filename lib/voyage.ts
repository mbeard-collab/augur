import { VoyageAIClient } from 'voyageai'

const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY! })

export async function embedText(text: string): Promise<number[]> {
  const result = await voyage.embed({
    input:           text,
    model:           'voyage-3-large',
    inputType:       'query',
    outputDimension: 1024,
  })
  return result.data![0].embedding!
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const result = await voyage.embed({
    input:           texts,
    model:           'voyage-3-large',
    inputType:       'document',
    outputDimension: 1024,
  })
  return result.data!.map((d) => d.embedding!)
}

export interface RerankCandidate {
  id:       string
  document: string
  [key: string]: unknown
}

export async function rerank<T extends RerankCandidate>(
  query:      string,
  candidates: T[],
  topK:       number = 8,
): Promise<T[]> {
  if (candidates.length === 0) return []

  const result = await voyage.rerank({
    query,
    documents: candidates.map((c) => c.document),
    model:     'rerank-2',
    topK:      Math.min(topK, candidates.length),
  })

  return result.data!.map((r) => candidates[r.index!])
}
