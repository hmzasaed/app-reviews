import { Smartphone } from 'lucide-react'
import { useState } from 'react'

export function AppIcon({ src, title, size = 'md' }: { src: string | null; title: string; size?: 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false)
  const cls = size === 'lg' ? 'size-14 rounded-2xl' : size === 'sm' ? 'size-8 rounded-lg' : 'size-11 rounded-xl'
  if (!src || failed) {
    return (
      <span className={`flex shrink-0 items-center justify-center bg-slate-100 text-slate-400 ${cls}`} aria-hidden>
        <Smartphone className="size-1/2" />
      </span>
    )
  }
  return (
    <img
      src={src}
      alt={`${title} icon`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`shrink-0 object-cover ring-1 ring-slate-200 ${cls}`}
    />
  )
}
