import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { inngest } from '@/inngest/client'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const isAdmin = profile.data?.role === 'admin'

  const query = supabase
    .from('questionnaires')
    .select('*, questions(count)')
    .order('created_at', { ascending: false })

  if (!isAdmin) query.eq('uploaded_by', user.id)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData  = await request.formData()
  const file      = formData.get('file') as File | null
  const name      = formData.get('name') as string
  const customer  = formData.get('customer') as string
  const format    = formData.get('format') as string
  const pasteText = formData.get('paste_text') as string | null

  let filePath: string | null = null

  if (file) {
    const bytes  = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const path   = `${user.id}/${Date.now()}-${file.name}`

    const { error: uploadError } = await supabase.storage
      .from('augur')
      .upload(path, buffer, { contentType: file.type })

    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })
    filePath = path
  }

  const { data: questionnaire, error } = await supabase
    .from('questionnaires')
    .insert({
      name,
      customer:      customer || null,
      source_format: format as 'excel' | 'word' | 'pdf' | 'paste' | 'portal',
      file_path:     filePath,
      uploaded_by:   user.id,
      status:        'pending',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // For paste format, parse lines into questions now so Inngest can find them
  if (format === 'paste' && pasteText?.trim()) {
    const lines = pasteText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      // Strip leading numbering like "1." "1)" "Q1."
      .map(l => l.replace(/^\s*(?:\d+[\.\)]\s*|[Qq]\d+[\.\):\s]+)/, '').trim())
      .filter(l => l.length > 0)

    if (lines.length > 0) {
      const { error: qError } = await supabase.from('questions').insert(
        lines.map((raw_text, i) => ({
          questionnaire_id: questionnaire.id,
          raw_text,
          sequence_index: i,
        }))
      )
      if (qError) return NextResponse.json({ error: qError.message }, { status: 500 })
    }
  }

  // Trigger Inngest processing
  const { ids } = await inngest.send({
    name: 'questionnaire/uploaded',
    data: { questionnaire_id: questionnaire.id, uploaded_by: user.id },
  })

  await supabase
    .from('questionnaires')
    .update({ inngest_event_id: ids[0] })
    .eq('id', questionnaire.id)

  return NextResponse.json(questionnaire, { status: 201 })
}
