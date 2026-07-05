import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ id: string }> }

export async function GET(_: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('questionnaires')
    .select(`
      *,
      questions (
        id,
        raw_text,
        location_ref,
        sequence_index,
        answers (
          id,
          answer_text,
          answer_type,
          citations,
          confidence,
          tier,
          status,
          source,
          routed_to_devsecops,
          created_at,
          updated_at
        )
      )
    `)
    .eq('id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}
