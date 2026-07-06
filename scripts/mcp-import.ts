#!/usr/bin/env -S npx tsx
/**
 * mcp-import.ts — Process MCP-staged Drive content and insert into Supabase KB.
 *
 * Input: JSON staging file written by the drive-kb-import Workflow (drive-staging.json).
 *
 * Routing:
 *   type=sheet → Claude Haiku extracts Q&A pairs → kb_entries
 *   type=doc   → chunks ~3000 chars → evidence_docs
 *   type=sheet with 0 Q&A pairs → falls back to evidence_docs
 *
 * Usage:
 *   npx tsx scripts/mcp-import.ts [path-to-staging-json]
 *
 * Default staging path: /private/tmp/claude-501/-Users-beard/.../scratchpad/drive-staging.json
 */

import { generateText } from 'ai'
import { anthropic as anthropicProvider } from '@ai-sdk/anthropic'
import { createClient } from '@supabase/supabase-js'
import { VoyageAIClient } from 'voyageai'
import { config as dotenvConfig } from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

dotenvConfig({ path: path.resolve(process.cwd(), '.env.local') })

// ── Config ─────────────────────────────────────────────────────────────────────
const DEFAULT_STAGING = '/private/tmp/claude-501/-Users-beard/d8bbcb7b-0344-4fcc-9859-0602bc2b2279/scratchpad/drive-staging.json'
const STAGING_FILE    = process.argv[2] ?? DEFAULT_STAGING
const VOYAGE_BATCH    = 96
const CHUNK_MAX_CHARS = 3000
const CHUNK_OVERLAP   = 300
const HAIKU_MODEL     = 'claude-haiku-4-5-20251001'

// ── Clients ────────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY! })

// ── Types ──────────────────────────────────────────────────────────────────────
interface StagedFile {
  id:        string
  title:     string
  type:      'doc' | 'sheet'
  sourceUrl: string
  content:   string
  ok:        boolean
}

interface QAPair {
  question: string
  answer:   string
  domain?:  string
}

// ── Q&A extraction (Haiku) ─────────────────────────────────────────────────────
async function extractQAPairs(content: string, title: string): Promise<QAPair[]> {
  const { text } = await generateText({
    model: anthropicProvider(HAIKU_MODEL),
    maxOutputTokens: 8096,
    prompt: `You are extracting answered Q&A pairs from a completed GovSpend security questionnaire.

The content is a text export from a spreadsheet or document titled "${title}".

Extract ALL rows where:
- The question is a substantive security/compliance question (not a header, section title, or instruction)
- The answer is a real, substantive GovSpend response (not empty, not "N/A", not "To be completed", not a placeholder)

Return a JSON array: [{"question": "...", "answer": "...", "domain": "..."}]

domain: infer from content (e.g. "Access Control", "Encryption", "Incident Response",
"Data Privacy", "Business Continuity", "Physical Security", "Vendor Management", "Governance", etc.)

Return ONLY the JSON array, no other text. If no valid pairs, return [].

Content (first 18000 chars):
${content.substring(0, 18000)}`,
  })

  try {
    const match = text.trim().match(/\[[\s\S]*\]/)
    const raw = JSON.parse(match?.[0] ?? '[]')
    return Array.isArray(raw)
      ? (raw as QAPair[]).filter(p => p.question?.trim().length > 10 && p.answer?.trim().length > 10)
      : []
  } catch {
    return []
  }
}

// ── Text chunking ──────────────────────────────────────────────────────────────
function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 20)
  const chunks: string[] = []
  let current = ''

  for (const para of paragraphs) {
    const joined = current ? current + '\n\n' + para : para
    if (joined.length > CHUNK_MAX_CHARS && current.length > 0) {
      chunks.push(current)
      current = current.slice(-CHUNK_OVERLAP) + '\n\n' + para
    } else {
      current = joined
    }
  }
  if (current.trim().length > 50) chunks.push(current.trim())
  return chunks.length > 0 ? chunks : [text.slice(0, CHUNK_MAX_CHARS)]
}

// ── Voyage embedding (global 3-RPM rate limiter + 429 backoff) ────────────────
// Free tier: 3 RPM, 10K TPM. We enforce ≥21s between any two embed calls.
let lastEmbedCallMs = 0
const MIN_EMBED_GAP_MS = 21000

async function embedOnce(batch: string[]): Promise<number[][]> {
  // Global inter-call gap (proactive throttle)
  const gap = Date.now() - lastEmbedCallMs
  if (lastEmbedCallMs > 0 && gap < MIN_EMBED_GAP_MS) {
    await new Promise(r => setTimeout(r, MIN_EMBED_GAP_MS - gap))
  }

  const MAX_RETRIES = 8
  let backoff = 30000

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await voyage.embed({
        input:           batch,
        model:           'voyage-3-large',
        inputType:       'document',
        outputDimension: 1024,
      })
      lastEmbedCallMs = Date.now()
      return res.data!.map(d => d.embedding!)
    } catch (err: unknown) {
      const msg = String(err)
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
        process.stdout.write(`\n    429 — waiting ${Math.round(backoff / 1000)}s (attempt ${attempt + 1})...`)
        await new Promise(r => setTimeout(r, backoff))
        backoff = Math.min(backoff * 1.5, 120000)
      } else {
        throw err
      }
    }
  }
  throw new Error('Voyage embed failed after max retries')
}

async function embedBatched(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = []
  for (let i = 0; i < texts.length; i += VOYAGE_BATCH) {
    const batch = texts.slice(i, i + VOYAGE_BATCH)
    embeddings.push(...await embedOnce(batch))
    if (texts.length > VOYAGE_BATCH) {
      process.stdout.write(`      Embedded ${Math.min(i + VOYAGE_BATCH, texts.length)}/${texts.length}\r`)
    }
  }
  if (texts.length > VOYAGE_BATCH) process.stdout.write('\n')
  return embeddings
}

// ── Insert kb_entries ──────────────────────────────────────────────────────────
async function insertKBEntries(file: StagedFile, pairs: QAPair[]): Promise<number> {
  if (pairs.length === 0) return 0

  console.log(`    ↳ ${pairs.length} Q&A pairs — embedding...`)

  await supabase.from('kb_entries')
    .delete()
    .like('internal_notes', `%"drive_id":"${file.id}"%`)

  const embeddings = await embedBatched(pairs.map(p => p.question))
  const driveNote  = JSON.stringify({ drive_id: file.id, drive_name: file.title })

  const records = pairs.map((pair, i) => ({
    domain:         pair.domain?.trim() || 'General',
    question:       pair.question.trim(),
    answer:         pair.answer.trim(),
    citations:      [] as string[],
    tier:           'public'   as const,
    confidence:     'high'     as const,
    status:         'approved' as const,
    internal_notes: driveNote,
    approved_by:    process.env.SEED_USER_ID!,
    approved_at:    new Date().toISOString(),
    embedding:      `[${embeddings[i].join(',')}]`,
  }))

  let inserted = 0
  for (let i = 0; i < records.length; i += 50) {
    const { error } = await supabase.from('kb_entries').insert(records.slice(i, i + 50))
    if (error) console.error(`    Insert error: ${error.message}`)
    else inserted += Math.min(50, records.length - i)
  }

  return inserted
}

// ── Insert evidence_docs ───────────────────────────────────────────────────────
async function insertEvidenceDocs(file: StagedFile): Promise<number> {
  const chunks    = chunkText(file.content)
  const sourceUrl = `https://drive.google.com/file/d/${file.id}`

  await supabase.from('evidence_docs')
    .delete()
    .like('source_url', `${sourceUrl}%`)

  console.log(`    ↳ ${chunks.length} chunks — embedding...`)

  const embeddings = await embedBatched(chunks)

  const records = chunks.map((chunk, i) => ({
    title:      file.title,
    section:    `Part ${i + 1} of ${chunks.length}`,
    content:    chunk,
    nda_gated:  false,
    source_url: `${sourceUrl}#chunk-${i}`,
    embedding:  `[${embeddings[i].join(',')}]`,
  }))

  let inserted = 0
  for (let i = 0; i < records.length; i += 50) {
    const { error } = await supabase.from('evidence_docs').insert(records.slice(i, i + 50))
    if (error) console.error(`    Insert error: ${error.message}`)
    else inserted += Math.min(50, records.length - i)
  }

  return inserted
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VOYAGE_API_KEY', 'SEED_USER_ID', 'ANTHROPIC_API_KEY']
    .filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(', ')}`)
    process.exit(1)
  }

  if (!fs.existsSync(STAGING_FILE)) {
    console.error(`Staging file not found: ${STAGING_FILE}`)
    console.error('Run the drive-kb-import Workflow in Claude Code first to generate it.')
    process.exit(1)
  }

  const staging: { files: StagedFile[] } = JSON.parse(fs.readFileSync(STAGING_FILE, 'utf-8'))
  const files = staging.files.filter(f => f.ok && f.content.length > 50)

  console.log(`\nProcessing ${files.length} staged files...\n`)

  let totalKB = 0, totalDocChunks = 0, errors = 0, fallbacks = 0

  for (const file of files) {
    if (file.type === 'sheet') {
      console.log(`SHEET  ${file.title}`)
      try {
        const pairs = await extractQAPairs(file.content, file.title)
        if (pairs.length === 0) {
          console.log(`    ↳ No Q&A pairs — falling back to evidence_docs`)
          const n = await insertEvidenceDocs(file)
          totalDocChunks += n
          fallbacks++
        } else {
          const n = await insertKBEntries(file, pairs)
          totalKB += n
        }
      } catch (e) {
        console.error(`    ERROR: ${(e as Error).message}`)
        errors++
      }
    } else {
      console.log(`DOC    ${file.title}`)
      try {
        const n = await insertEvidenceDocs(file)
        totalDocChunks += n
      } catch (e) {
        console.error(`    ERROR: ${(e as Error).message}`)
        errors++
      }
    }
  }

  console.log('\n────────────────────────────────────')
  console.log(`KB entries (kb_entries):    ${totalKB}`)
  console.log(`Evidence chunks (evidence_docs): ${totalDocChunks}`)
  console.log(`Sheet→doc fallbacks:        ${fallbacks}`)
  if (errors > 0) console.log(`Errors:                     ${errors}`)
  console.log('────────────────────────────────────')
}

main().catch(e => { console.error(e); process.exit(1) })
