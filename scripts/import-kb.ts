#!/usr/bin/env -S npx tsx
/**
 * KB Importer — seeds the knowledge base from the GovSpend Answer Bank spreadsheet.
 *
 * Usage:
 *   SEED_USER_ID=<admin-uuid> npx tsx scripts/import-kb.ts path/to/AnswerBank.xlsx
 *
 * Expected columns (case-insensitive, fuzzy-matched):
 *   Domain | Question | Answer | Source Citation | Sensitivity Tier | Confidence | Internal Notes
 */

import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'
import { VoyageAIClient } from 'voyageai'
import { config as dotenvConfig } from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

dotenvConfig({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY! })

const TIER_MAP: Record<string, string> = {
  'public':        'public',
  'public-review': 'public_review',
  'public review': 'public_review',
  'nda':           'nda_gated',
  'nda-gated':     'nda_gated',
  'nda_gated':     'nda_gated',
}

const CONFIDENCE_MAP: Record<string, string> = {
  'high':   'high',
  'medium': 'medium',
  'gap':    'gap',
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string')  return value.trim()
  if (typeof value === 'number')  return String(value)
  if (typeof value === 'boolean') return String(value)
  if (value instanceof Date)      return value.toISOString()
  if (typeof value === 'object' && 'text' in value) return String((value as { text: unknown }).text ?? '')
  if (typeof value === 'object' && 'result' in value) return String((value as { result: unknown }).result ?? '')
  return String(value)
}

function normalize(h: string): string {
  return h.toLowerCase().replace(/[\s_\-()]+/g, '')
}

function findCol(headers: string[], candidates: string[]): number {
  const normed = headers.map(normalize)
  for (const c of candidates) {
    const idx = normed.indexOf(normalize(c))
    if (idx !== -1) return idx
  }
  return -1
}

async function main() {
  const filePath = process.argv[2]
  if (!filePath) {
    console.error('Usage: npx tsx scripts/import-kb.ts <path-to-xlsx>')
    process.exit(1)
  }
  if (!fs.existsSync(filePath)) { console.error(`File not found: ${filePath}`); process.exit(1) }

  const seedUserId = process.env.SEED_USER_ID
  if (!seedUserId) { console.error('Set SEED_USER_ID in .env.local'); process.exit(1) }

  console.log(`📂 Loading ${path.basename(filePath)}…`)

  const workbook = new ExcelJS.Workbook()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(fs.readFileSync(filePath) as any)
  const sheet = workbook.worksheets[0]

  const rows: string[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[]
    rows.push(values.slice(1).map(cellToString))
  })

  const headers  = rows[0]
  const dataRows = rows.slice(1).filter((r) => r.some((c) => c.length > 0))

  const colDomain   = findCol(headers, ['domain', 'category'])
  const colQuestion = findCol(headers, ['question'])
  const colAnswer   = findCol(headers, ['answer', 'response'])
  const colCitation = findCol(headers, ['sourcecitation', 'citation', 'source'])
  const colTier     = findCol(headers, ['sensitivitytier', 'tier', 'sensitivity'])
  const colConf     = findCol(headers, ['confidence'])
  const colNotes    = findCol(headers, ['internalnotes', 'notes'])

  if (colQuestion === -1 || colAnswer === -1) {
    console.error('Could not find Question or Answer columns. Headers:', headers)
    process.exit(1)
  }

  const validRows = dataRows.filter((r) => {
    const answer = r[colAnswer] ?? ''
    return answer.length > 10 && !answer.startsWith('This question requires review')
  })

  console.log(`✅ ${validRows.length} rows with real answers`)
  console.log(`🔢 Embedding via Voyage AI…`)

  const BATCH = 96
  const embeddings: number[][] = []
  for (let i = 0; i < validRows.length; i += BATCH) {
    const batch = validRows.slice(i, i + BATCH).map((r) => r[colQuestion])
    const result = await voyage.embed({ input: batch, model: 'voyage-3-large', inputType: 'document', outputDimension: 1024 })
    embeddings.push(...result.data!.map((d) => d.embedding!))
    process.stdout.write(`   ${Math.min(i + BATCH, validRows.length)}/${validRows.length}\r`)
  }
  console.log()
  console.log('💾 Inserting into Supabase…')

  const INSERT_BATCH = 50
  let inserted = 0, skipped = 0

  for (let i = 0; i < validRows.length; i += INSERT_BATCH) {
    const batch   = validRows.slice(i, i + INSERT_BATCH)
    const records = batch.map((row, j) => {
      const rawTier = (colTier !== -1 ? row[colTier] : 'public').toLowerCase()
      const rawConf = (colConf !== -1 ? row[colConf] : 'high').toLowerCase()
      const citation = colCitation !== -1 ? row[colCitation] : ''
      return {
        domain:         colDomain !== -1 ? row[colDomain] : 'General',
        question:       row[colQuestion],
        answer:         row[colAnswer],
        citations:      citation ? [{ title: citation, relevance: 'Source document' }] : [],
        tier:           TIER_MAP[rawTier]     ?? 'public',
        confidence:     CONFIDENCE_MAP[rawConf] ?? 'high',
        status:         'approved' as const,
        internal_notes: colNotes !== -1 ? row[colNotes] || null : null,
        approved_by:    seedUserId,
        approved_at:    new Date().toISOString(),
        embedding:      `[${embeddings[i + j].join(',')}]`,
      }
    })

    const { error } = await supabase.from('kb_entries').insert(records)
    if (error) { console.error(`Batch failed:`, error.message); skipped += batch.length }
    else { inserted += batch.length }
  }

  console.log(`\n✅ Done — ${inserted} imported, ${skipped} failed.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
