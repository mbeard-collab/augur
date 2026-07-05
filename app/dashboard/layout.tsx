import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, email')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'

  return (
    <div className="flex h-screen overflow-hidden bg-black">
      {/* Sidebar */}
      <nav className="w-52 shrink-0 flex flex-col border-r border-zinc-900 py-5 px-3">
        <div className="flex items-center gap-2 px-2 mb-6">
          <div className="w-5 h-5 rounded bg-[#0070f3]" />
          <span className="text-sm font-medium text-white">GovSpend</span>
        </div>

        <div className="flex-1 space-y-0.5">
          <NavItem href="/dashboard" label="Questionnaires" />
          <NavItem href="/dashboard/new" label="New Upload" />
          {isAdmin && <NavItem href="/dashboard/review" label="Review Queue" badge />}
          {isAdmin && <NavItem href="/dashboard/kb" label="Knowledge Base" />}
        </div>

        <div className="border-t border-zinc-900 pt-4 px-2">
          <p className="text-xs text-zinc-500 truncate">{profile?.email}</p>
          <p className="text-xs text-zinc-700 mt-0.5 capitalize">{profile?.role}</p>
        </div>
      </nav>

      {/* Main */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  )
}

function NavItem({ href, label, badge }: { href: string; label: string; badge?: boolean }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-white"
    >
      {label}
      {badge && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#0070f3]" />
      )}
    </Link>
  )
}
