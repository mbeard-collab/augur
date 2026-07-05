export function formatDistanceToNow(dateStr: string): string {
  const date  = new Date(dateStr)
  const now   = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffM  = Math.floor(diffMs / 60000)

  if (diffM < 1)   return 'just now'
  if (diffM < 60)  return `${diffM}m ago`
  const diffH = Math.floor(diffM / 60)
  if (diffH < 24)  return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7)   return `${diffD}d ago`
  const diffW = Math.floor(diffD / 7)
  if (diffW < 5)   return `${diffW}w ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ')
}
