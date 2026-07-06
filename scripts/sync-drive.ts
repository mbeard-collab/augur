#!/usr/bin/env -S npx tsx
/**
 * Google Drive KB Sync — imports GovSpend policy documents and Q&A spreadsheets.
 *
 * Usage:
 *   npm run sync-drive
 *   npm run sync-drive -- --force   # re-process all files, ignore cache
 *
 * Routing by MIME type:
 *   Spreadsheets (Google Sheets, Excel, CSV) → kb_entries via Haiku column detection
 *   Documents (Google Docs, Word, PDF, text) → evidence_docs (chunked)
 *
 * Incremental: skips files unchanged since last run (.drive-sync-state.json).
 * On change: deletes old records by Drive file ID before reinserting.
 */

import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { VoyageAIClient } from 'voyageai'
import { config as dotenvConfig } from 'dotenv'
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import { getDocumentProxy, extractText } from 'unpdf'
import { detectColumns } from '../lib/ai/column-mapper'
import * as fs from 'fs'
import * as path from 'path'

dotenvConfig({ path: '.env.local' })

// ── Config ─────────────────────────────────────────────────────────────────────
const FORCE     = process.argv.includes('--force')
const CACHE_FILE = path.resolve('.drive-sync-state.json')
const VOYAGE_BATCH   = 96
const CHUNK_MAX_CHARS = 3000
const CHUNK_OVERLAP   = 300

// ── Clients ────────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY! })

function buildGoogleAuth() {
  const keyParam = process.env.GOOGLE_SERVICE_ACCOUNT_JSON!
  const credentials: object = keyParam.trimStart().startsWith('{')
    ? JSON.parse(keyParam)
    : JSON.parse(fs.readFileSync(path.resolve(keyParam), 'utf-8'))

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  })
}

// ── Cache ──────────────────────────────────────────────────────────────────────
type SyncState = Record<string, { modifiedTime: string; processedAt: string }>

function loadCache(): SyncState {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) } catch { return {} }
}

function saveCache(state: SyncState) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(state, null, 2))
}

// ── File listing ───────────────────────────────────────────────────────────────
interface DriveFile {
  id:           string
  name:         string
  mimeType:     string
  modifiedTime: string
  webViewLink:  string
}

async function listFilesRecursive(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  drive: any,
  folderId: string,
): Promise<DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken: string | undefined

  do {
    const res = await drive.files.list({
      q:      `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)',
      pageToken,
    })

    for (const f of (res.data.files ?? [])) {
      if (f.mimeType === 'application/vnd.google-apps.folder') {
        files.push(...await listFilesRecursive(drive, f.id!))
      } else {
        files.push(f as DriveFile)
      }
    }

    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  return files
}

// ── MIME routing ───────────────────────────────────────────────────────────────
const SPREADSHEET_MIMES = new Set([
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
])

const DOCUMENT_MIMES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
  'text/plain',
  'text/markdown',
])

function classifyFile(mimeType: string): 'spreadsheet' | 'document' | null {
  if (SPREADSHEET_MIMES.has(mimeType)) return 'spreadsheet'
  if (DOCUMENT_MIMES.has(mimeType))   return 'document'
  return null
}

// ── Content extraction ─────────────────────────────────────────────────────────
function cellToString(v: ExcelJS.CellValue): string {
  if (v == null) return ''
  if (typeof v === 'string')  return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    if ('text'   in v) return String((v as { text: unknown }).text ?? '')
    if ('result' in v) return String((v as { result: unknown }).result ?? '')
  }
  return String(v)
}

async function extractSpreadsheetRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  drive: any,
  file: DriveFile,
): Promise<{ headers: string[]; rows: string[][] }> {
  let buffer: Buffer

  if (file.mimeType === 'text/csv') {
    const res = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'text' })
    const lines = (res.data as string)
      .split('\n')
      .map((l: string) => l.split(',').map((c: string) => c.replace(/^"|"$/g, '').trim()))
      .filter((l: string[]) => l.some(c => c.length > 0))
    return { headers: lines[0] ?? [], rows: lines.slice(1) }
  }

  if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { responseType: 'arraybuffer' },
    )
    buffer = Buffer.from(res.data as ArrayBuffer)
  } else {
    const res = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' })
    buffer = Buffer.from(res.data as ArrayBuffer)
  }

  const workbook = new ExcelJS.Workbook()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any)
  const sheet = workbook.worksheets[0]

  const allRows: string[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const vals = (row.values as ExcelJS.CellValue[]).slice(1)
    allRows.push(vals.map(cellToString))
  })

  return { headers: allRows[0] ?? [], rows: allRows.slice(1) }
}

async function extractDocumentText(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  drive: any,
  file: DriveFile,
): Promise<string> {
  if (file.mimeType === 'application/vnd.google-apps.document') {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: 'text/plain' },
      { responseType: 'text' },
    )
    return res.data as string
  }

  const res = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' })
  const data = res.data as ArrayBuffer

  if (file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data) })
    return value
  }

  if (file.mimeType === 'application/pdf') {
    const proxy = await getDocumentProxy(new Uint8Array(data))
    const result = await extractText(proxy, { mergePages: true })
    const text = result.text
    return Array.isArray(text) ? text.join('\n') : (text as string)
  }

  // plain text / markdown
  return Buffer.from(data).toString('utf-8')
}

// ── Chunking ───────────────────────────────────────────────────────────────────
function chunkText(text: string): string[] {
  const chunks: string[] = []
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 20)
  let current = ''

  for (const para of paragraphs) {
    const joined = current ? current + '\n\n' + para : para
    if (joined.length > CHUNK_MAX_CHARS && current.length > 0) {
      chunks.push(current)
      // seed next chunk with overlap
      current = current.slice(-CHUNK_OVERLAP) + '\n\n' + para
    } else {
      current = joined
    }
  }

  if (current.trim().length > 50) chunks.push(current.trim())
  return chunks.length > 0 ? chunks : [text.slice(0, CHUNK_MAX_CHARS)]
}

// ── Supabase helpers ───────────────────────────────────────────────────────────
async function embedBatched(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = []
  for (let i = 0; i < texts.length; i += VOYAGE_BATCH) {
    const batch = texts.slice(i, i + VOYAGE_BATCH)
    const res = await voyage.embed({
      input:           batch,
      model:           'voyage-3-large',
      inputType:       'document',
      outputDimension: 1024,
    })
    embeddings.push(...res.data!.map(d => d.embedding!))
    process.stdout.write(`    Embedded ${Math.min(i + VOYAGE_BATCH, texts.length)}/${texts.length}\r`)
  }
  if (texts.length > VOYAGE_BATCH) console.log()
  return embeddings
}

function normalize(h: string): string {
  return h.toLowerCase().replace(/[\s_\-()]+/g, '')
}

function findColIndex(headers: string[], name: string): number {
  const n = normalize(name)
  return headers.findIndex(h => normalize(h) === n)
}

// ── KB ingestion (spreadsheets → kb_entries) ───────────────────────────────────
async function ingestSpreadsheet(
  file: DriveFile,
  headers: string[],
  rows: string[][],
): Promise<{ inserted: number; skipped: number }> {
  if (headers.length === 0 || rows.length === 0) return { inserted: 0, skipped: 0 }

  const sampleRows = rows.slice(0, 5)
  let qIdx = -1
  let aIdx = -1

  try {
    const colMap = await detectColumns(headers, sampleRows)
    qIdx = findColIndex(headers, colMap.question_column)
    aIdx = colMap.answer_column ? findColIndex(headers, colMap.answer_column) : -1
  } catch (e) {
    console.log(`    ↳ Column detection failed: ${(e as Error).message} — skipping`)
    return { inserted: 0, skipped: rows.length }
  }

  if (qIdx === -1) {
    console.log(`    ↳ Could not locate question column — skipping`)
    return { inserted: 0, skipped: rows.length }
  }

  // Try to find domain, citation columns with simple matching
  const domainIdx    = findColIndex(headers, 'domain')   !== -1 ? findColIndex(headers, 'domain')   : findColIndex(headers, 'category')
  const citationIdx  = findColIndex(headers, 'citation') !== -1 ? findColIndex(headers, 'citation') : findColIndex(headers, 'source')
  const tierIdx      = findColIndex(headers, 'tier')     !== -1 ? findColIndex(headers, 'tier')     : findColIndex(headers, 'sensitivity')
  const notesIdx     = findColIndex(headers, 'notes')

  const validRows = rows.filter(r => {
    const q = r[qIdx]?.trim() ?? ''
    const a = aIdx !== -1 ? (r[aIdx]?.trim() ?? '') : ''
    return q.length > 5 && a.length > 5 && !a.startsWith('This question requires review')
  })

  if (validRows.length === 0) {
    console.log(`    ↳ No valid Q&A rows found`)
    return { inserted: 0, skipped: rows.length }
  }

  console.log(`    ↳ ${validRows.length} Q&A rows — embedding…`)

  // Remove stale entries for this Drive file
  await supabase.from('kb_entries').delete().like('internal_notes', `%"drive_id":"${file.id}"%`)

  const embeddings = await embedBatched(validRows.map(r => r[qIdx]))

  const TIER_MAP: Record<string, 'public' | 'public_review' | 'nda_gated'> = {
    public:        'public',
    'public-review': 'public_review',
    'public review': 'public_review',
    nda:           'nda_gated',
    'nda-gated':   'nda_gated',
    nda_gated:     'nda_gated',
  }

  const INSERT_BATCH = 50
  let inserted = 0, skipped = 0

  for (let i = 0; i < validRows.length; i += INSERT_BATCH) {
    const batch = validRows.slice(i, i + INSERT_BATCH)
    const records = batch.map((row, j) => {
      const rawTier = (tierIdx !== -1 ? row[tierIdx] : 'public').toLowerCase().trim()
      const citation = citationIdx !== -1 ? row[citationIdx]?.trim() : ''
      const driveNote = JSON.stringify({ drive_id: file.id, drive_name: file.name, drive_modified: file.modifiedTime })
      const userNotes = notesIdx !== -1 ? (row[notesIdx]?.trim() ?? null) : null

      return {
        domain:         domainIdx !== -1 ? (row[domainIdx]?.trim() || 'General') : 'General',
        question:       row[qIdx].trim(),
        answer:         aIdx !== -1 ? row[aIdx].trim() : '',
        citations:      citation ? [{ title: citation, relevance: 'Source document' }] : [],
        tier:           TIER_MAP[rawTier] ?? 'public',
        confidence:     'high'     as const,
        status:         'approved' as const,
        internal_notes: userNotes ? `${driveNote}|||${userNotes}` : driveNote,
        approved_by:    process.env.SEED_USER_ID!,
        approved_at:    new Date().toISOString(),
        embedding:      `[${embeddings[i + j].join(',')}]`,
      }
    })

    const { error } = await supabase.from('kb_entries').insert(records)
    if (error) { skipped += batch.length; console.error(`    Insert error: ${error.message}`) }
    else inserted += batch.length
  }

  return { inserted, skipped }
}

// ── Evidence ingestion (documents → evidence_docs) ─────────────────────────────
async function ingestDocument(
  file: DriveFile,
  text: string,
): Promise<{ inserted: number; skipped: number }> {
  const chunks    = chunkText(text)
  const sourceUrl = `https://drive.google.com/file/d/${file.id}`

  // Remove stale chunks for this Drive file
  await supabase.from('evidence_docs').delete().like('source_url', `${sourceUrl}%`)

  console.log(`    ↳ ${chunks.length} chunks — embedding…`)

  const embeddings = await embedBatched(chunks)

  const INSERT_BATCH = 50
  let inserted = 0, skipped = 0

  for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
    const batch = chunks.slice(i, i + INSERT_BATCH)
    const records = batch.map((chunk, j) => ({
      title:      file.name,
      section:    `Part ${i + j + 1} of ${chunks.length}`,
      content:    chunk,
      nda_gated:  false,
      source_url: `${sourceUrl}#chunk-${i + j}`,
      embedding:  `[${embeddings[i + j].join(',')}]`,
    }))

    const { error } = await supabase.from('evidence_docs').insert(records)
    if (error) { skipped += batch.length; console.error(`    Insert error: ${error.message}`) }
    else inserted += batch.length
  }

  return { inserted, skipped }
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const missing = ['GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_DRIVE_FOLDER_IDS', 'VOYAGE_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SEED_USER_ID']
    .filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(', ')}`)
    process.exit(1)
  }

  const folderIds = process.env.GOOGLE_DRIVE_FOLDER_IDS!.split(',').map(s => s.trim()).filter(Boolean)
  const auth  = buildGoogleAuth()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drive = google.drive({ version: 'v3', auth: auth as any })
  const cache = FORCE ? {} : loadCache()

  // ── List all files across all folders ────────────────────────────────────────
  console.log('Scanning Drive folders…\n')
  const allFiles: DriveFile[] = []

  for (const folderId of folderIds) {
    const files = await listFilesRecursive(drive, folderId)
    console.log(`  Folder ${folderId}: ${files.length} file(s)`)
    allFiles.push(...files)
  }

  // Dedup by file ID in case of shared files or overlapping folders
  const seen  = new Set<string>()
  const files = allFiles.filter(f => { if (seen.has(f.id)) return false; seen.add(f.id); return true })

  const supported = files.filter(f => classifyFile(f.mimeType) !== null)
  const ignored   = files.length - supported.length

  console.log(`\n${files.length} total (${supported.length} supported, ${ignored} unsupported)\n`)
  if (FORCE) console.log('--force: skipping cache, reprocessing everything\n')

  // ── Process each file ─────────────────────────────────────────────────────────
  let kbRows = 0, docChunks = 0, unchanged = 0, errors = 0

  for (const file of supported) {
    const type   = classifyFile(file.mimeType)!
    const cached = cache[file.id]

    if (!FORCE && cached?.modifiedTime === file.modifiedTime) {
      console.log(`SKIP (unchanged)  ${file.name}`)
      unchanged++
      continue
    }

    const tag = type === 'spreadsheet' ? 'KB  ' : 'DOC '
    console.log(`${tag} ${file.name}`)

    try {
      if (type === 'spreadsheet') {
        const { headers, rows } = await extractSpreadsheetRows(drive, file)
        const { inserted, skipped } = await ingestSpreadsheet(file, headers, rows)
        kbRows += inserted
        if (skipped > 0) console.log(`    ↳ ${skipped} rows skipped`)
      } else {
        const text = await extractDocumentText(drive, file)
        if (text.trim().length < 100) {
          console.log(`    ↳ Content too short — skipping`)
          unchanged++
          continue
        }
        const { inserted, skipped } = await ingestDocument(file, text)
        docChunks += inserted
        if (skipped > 0) console.log(`    ↳ ${skipped} chunks failed`)
      }

      cache[file.id] = { modifiedTime: file.modifiedTime, processedAt: new Date().toISOString() }
      saveCache(cache)
    } catch (err) {
      console.error(`    ERROR: ${(err as Error).message}`)
      errors++
    }
  }

  console.log('\n──────────────────────────────')
  console.log(`KB entries added:        ${kbRows}`)
  console.log(`Evidence doc chunks:     ${docChunks}`)
  console.log(`Unchanged (skipped):     ${unchanged}`)
  if (errors > 0) console.log(`Errors:                  ${errors}`)
  console.log('──────────────────────────────')
}

main().catch(e => { console.error(e); process.exit(1) })
