import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ id: string }> }

// PATCH /api/questionnaires/[id]/answers — approve, edit, or route an answer
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: questionnaire_id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const isAdmin = profile.data?.role === 'admin'

  const body: {
    answer_id:    string
    action:       'approve' | 'reject' | 'edit' | 'route'
    answer_text?: string
    notes?:       string
  } = await request.json()

  if (body.action === 'approve' && !isAdmin) {
    return NextResponse.json({ error: 'Only admins can approve answers' }, { status: 403 })
  }

  const updates: Record<string, unknown> = {}

  if (body.action === 'approve') {
    updates.status = 'approved'
  } else if (body.action === 'reject') {
    updates.status = 'rejected'
  } else if (body.action === 'edit' && body.answer_text) {
    updates.answer_text = body.answer_text
    updates.source      = 'human'
    updates.status      = 'pending_review'
  } else if (body.action === 'route') {
    updates.routed_to_devsecops = true
    updates.status              = 'pending_review'

    await supabase.from('review_queue').upsert({
      answer_id: body.answer_id,
      reason:    'manual',
      status:    'open',
    })
  }

  const { error } = await supabase
    .from('answers')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(updates as any)
    .eq('id', body.answer_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from('audit_log').insert({
    actor_id:    user.id,
    action:      body.action,
    entity_type: 'answer',
    entity_id:   body.answer_id,
    metadata:    questionnaire_id,   // simplified to avoid Json nesting error
  })

  return NextResponse.json({ ok: true })
}
