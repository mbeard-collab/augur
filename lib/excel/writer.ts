import ExcelJS from 'exceljs'
import { GAP_PLACEHOLDERS } from '@/lib/constants'
import type { AnswerType } from '@/lib/constants'

export interface AnswerToWrite {
  location_ref:  string   // e.g. "Sheet1!B5"
  answer_type:   AnswerType
  display_text:  string
  confidence:    string
}

// Write answers back into the original workbook, preserving all formatting.
// The answer is written into the column to the right of the question column
// (or into an existing answer column if detected).
export async function writeAnswersToExcel(
  originalBuffer: Buffer,
  answers:        AnswerToWrite[],
  answerColumn?:  string,  // e.g. "C" — if known from column mapping
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(originalBuffer as any)

  // Group by sheet
  const bySheet = new Map<string, AnswerToWrite[]>()
  for (const ans of answers) {
    const match = ans.location_ref.match(/^(.+)!([A-Z]+)(\d+)$/)
    if (!match) continue
    const sheetName = match[1]
    if (!bySheet.has(sheetName)) bySheet.set(sheetName, [])
    bySheet.get(sheetName)!.push(ans)
  }

  for (const [sheetName, sheetAnswers] of bySheet) {
    const sheet = workbook.getWorksheet(sheetName)
    if (!sheet) continue

    for (const ans of sheetAnswers) {
      const match = ans.location_ref.match(/!([A-Z]+)(\d+)$/)
      if (!match) continue
      const qCol  = letterToColIndex(match[1])
      const rowNum = parseInt(match[2], 10)

      // Write into the next column over (or the specified answer column)
      const aColIndex = answerColumn ? letterToColIndex(answerColumn) : qCol + 1
      const cell      = sheet.getCell(rowNum, aColIndex + 1) // ExcelJS is 1-indexed

      cell.value = ans.display_text

      // Light styling: italicise gap placeholders so reviewers spot them
      if (ans.answer_type !== 'grounded') {
        cell.font = { italic: true, color: { argb: 'FF888888' } }
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

function letterToColIndex(letter: string): number {
  let index = 0
  for (const ch of letter.toUpperCase()) {
    index = index * 26 + (ch.charCodeAt(0) - 64)
  }
  return index - 1
}
