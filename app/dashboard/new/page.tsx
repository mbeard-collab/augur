'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

export default function NewQuestionnairePage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [mode, setMode]         = useState<'file' | 'paste'>('file')
  const [name, setName]         = useState('')
  const [customer, setCustomer] = useState('')
  const [pasteText, setPaste]   = useState('')
  const [file, setFile]         = useState<File | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function submit() {
    if (!name.trim()) { setError('Name is required'); return }
    if (mode === 'file' && !file) { setError('Select a file'); return }
    if (mode === 'paste' && !pasteText.trim()) { setError('Paste some questions'); return }

    setLoading(true)
    setError(null)

    try {
      const fd = new FormData()
      fd.append('name', name)
      fd.append('customer', customer)

      if (mode === 'file' && file) {
        const ext = file.name.split('.').pop()?.toLowerCase()
        const fmt = ext === 'xlsx' || ext === 'xls' ? 'excel'
          : ext === 'docx' || ext === 'doc' ? 'word'
          : ext === 'pdf' ? 'pdf'
          : 'excel'
        fd.append('format', fmt)
        fd.append('file', file)
      } else {
        fd.append('format', 'paste')
        fd.append('paste_text', pasteText)
      }

      const res = await fetch('/api/questionnaires', { method: 'POST', body: fd })
      if (!res.ok) throw new Error((await res.json()).error)
      const q = await res.json()
      router.push(`/dashboard/questionnaires/${q.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-lg mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-white">New Questionnaire</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Upload a customer security questionnaire to auto-draft answers.
          </p>
        </div>

        {/* Name + customer */}
        <div className="space-y-3">
          <Field label="Questionnaire name" required>
            <Input
              value={name}
              onChange={setName}
              placeholder="e.g. Acme Corp SIG Lite 2025"
            />
          </Field>
          <Field label="Customer / account">
            <Input
              value={customer}
              onChange={setCustomer}
              placeholder="e.g. Acme Corp"
            />
          </Field>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-md border border-zinc-800 overflow-hidden">
          {(['file', 'paste'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                mode === m
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {m === 'file' ? 'Upload file' : 'Paste questions'}
            </button>
          ))}
        </div>

        {mode === 'file' ? (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.docx,.doc,.pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-800 py-10 text-sm text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
            >
              {file ? (
                <>
                  <p className="font-medium text-white">{file.name}</p>
                  <p className="text-xs mt-1">{(file.size / 1024).toFixed(0)} KB — click to change</p>
                </>
              ) : (
                <>
                  <p>Click to select a file</p>
                  <p className="text-xs mt-1">Excel (.xlsx), Word (.docx), PDF</p>
                </>
              )}
            </button>
          </div>
        ) : (
          <Field label="Paste questions (one per line)">
            <textarea
              value={pasteText}
              onChange={(e) => setPaste(e.target.value)}
              rows={10}
              placeholder={"1. Do you have a data classification policy?\n2. Describe your incident response process.\n3. ..."}
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-700 focus:border-[#0070f3] focus:outline-none resize-none"
            />
          </Field>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          onClick={submit}
          disabled={loading}
          className="w-full rounded-md bg-[#0070f3] py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? 'Uploading…' : 'Process questionnaire'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-400">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-700 focus:border-[#0070f3] focus:outline-none"
    />
  )
}
