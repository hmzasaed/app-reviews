/** Legend rendered in HTML (text stays in ink colors; the swatch carries identity). */
export function ChartLegend({ items }: { items: { label: string; color: string; shape?: 'square' | 'line' }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          {item.shape === 'line' ? (
            <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />
          ) : (
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: item.color }} aria-hidden />
          )}
          {item.label}
        </li>
      ))}
    </ul>
  )
}
