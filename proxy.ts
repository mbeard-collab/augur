import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const ALLOWED_DOMAIN = 'govspend.com'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll:  () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isAuthRoute    = request.nextUrl.pathname.startsWith('/auth')
  const isApiRoute     = request.nextUrl.pathname.startsWith('/api')
  const isPublicAsset  = request.nextUrl.pathname.startsWith('/_next')

  if (isPublicAsset || isApiRoute) return response

  if (!user) {
    if (!isAuthRoute) {
      return NextResponse.redirect(new URL('/auth', request.url))
    }
    return response
  }

  // Domain restriction — only @govspend.com
  const email = user.email ?? ''
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/auth?error=domain', request.url))
  }

  // Redirect authenticated user away from /auth
  if (isAuthRoute) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
