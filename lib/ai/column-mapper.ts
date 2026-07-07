import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'
import { COLUMN_MAPPING_SYSTEM } from './prompts'

const ColumnMapSchema = z.object({
  question_column:     z.string().describe('Column name/letter that contains the customer questions'),
  answer_column:       z.string().nullable().describe('Column name/letter for vendor responses, if present'),
  additional_columns:  z.array(z.string()).describe('Other related columns (comments, guidance, etc.)'),
  confidence:          z.enum(['high', 'medium', 'low']),
  notes:               z.string().describe('Brief explanation of how columns were identified'),
})

export type ColumnMap = {
  question_column:    string
  answer_column:      string | null
  additional_columns: string[]
  confidence:         'high' | 'medium' | 'low'
}

export async function detectColumns(
  headers:    string[],
  sampleRows: string[][],   // first 3–5 data rows
): Promise<ColumnMap> {
  const preview = [
    headers.join(' | '),
    ...sampleRows.map((row) => row.join(' | ')),
  ].join('\n')

  const { object } = await generateObject({
    model:       anthropic('claude-haiku-4-5-20251001'),   // cheap — just reading headers
    schema:      ColumnMapSchema,
    system:      COLUMN_MAPPING_SYSTEM,
    prompt:      `Spreadsheet columns and sample data:\n\n${preview}`,
    temperature: 0,
  })

  return {
    question_column:    object.question_column,
    answer_column:      object.answer_column,
    additional_columns: object.additional_columns,
    confidence:         object.confidence,
  }
}
