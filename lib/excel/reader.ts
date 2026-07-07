import ExcelJS from 'exceljs'
import { detectColumns } from '@/lib/ai/column-mapper'

export interface ExtractedQuestion {
  raw_text:       string
  location_ref:   string
  sequence_index: number
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

async function extractFromSheet(
  sheet: ExcelJS.Worksheet,
  sequenceOffset: number,
): Promise<ExtractedQuestion[]> {
  const rows: string[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[]
    rows.push(values.slice(1).map(cellToString))
  })

  if (rows.length < 2) return []

  const headers    = rows[0]
  const sampleRows = rows.slice(1, 5)

  const columnMap = await detectColumns(headers, sampleRows)
  if (columnMap.confidence === 'low') return []

  let qColIndex = headers.findIndex(
    (h) => h.toLowerCase() === columnMap.question_column.toLowerCase(),
  )
  if (qColIndex === -1) {
    const letter      = columnMap.question_column.toUpperCase()
    const letterIndex = letter.charCodeAt(0) - 65
    qColIndex         = letterIndex >= 0 && letterIndex < headers.length ? letterIndex : 0
  }

  return rows
    .slice(1)
    .map((row, i) => ({ text: row[qColIndex] ?? '', rowNum: i + 2 }))
    .filter(({ text }) => text.length > 5)
    .map(({ text, rowNum }, i) => ({
      raw_text:       text,
      location_ref:   `${sheet.name}!${colIndexToLetter(qColIndex)}${rowNum}`,
      sequence_index: sequenceOffset + i,
    }))
}

export async function extractQuestionsFromExcel(buffer: ArrayBuffer | Buffer): Promise<ExtractedQuestion[]> {
  const workbook = new ExcelJS.Workbook()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any)

  if (workbook.worksheets.length === 0) throw new Error('No worksheets found in file')

  const all: ExtractedQuestion[] = []
  for (const sheet of workbook.worksheets) {
    const questions = await extractFromSheet(sheet, all.length)
    all.push(...questions)
  }

  if (all.length === 0) throw new Error('No questions found in any sheet')
  return all
}

function colIndexToLetter(index: number): string {
  let letter = ''
  let n = index
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter
    n = Math.floor(n / 26) - 1
  }
  return letter
}
