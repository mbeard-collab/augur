import ExcelJS from 'exceljs'

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
  if (typeof value === 'object' && 'richText' in value)
    return (value as { richText: Array<{ text?: string }> }).richText.map(r => r.text ?? '').join('').trim()
  if (typeof value === 'object' && 'text' in value) return String((value as { text: unknown }).text ?? '')
  if (typeof value === 'object' && 'result' in value) return String((value as { result: unknown }).result ?? '')
  return String(value)
}

function extractFromSheet(
  sheet: ExcelJS.Worksheet,
  sequenceOffset: number,
): ExtractedQuestion[] {
  const rows: string[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[]
    rows.push(values.slice(1).map(cellToString))
  })

  if (rows.length < 2) return []

  // Find the column with the most cells containing substantial text (15–600 chars).
  // Uploaded questionnaires always have empty answer slots, so the question column wins.
  const scores: number[] = []
  rows.slice(1).forEach(row => {
    row.forEach((cell, i) => {
      if (cell.length >= 15 && cell.length <= 600) scores[i] = (scores[i] ?? 0) + 1
    })
  })
  const qColIndex = scores.length > 0
    ? scores.reduce((best, s, i) => (s ?? 0) > (scores[best] ?? 0) ? i : best, 0)
    : 0

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
    const questions = extractFromSheet(sheet, all.length)
    // Skip sheets that yield fewer than 2 questions — likely cover pages or lookup tables
    if (questions.length >= 2) all.push(...questions)
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
