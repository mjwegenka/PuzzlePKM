import React from 'react'
import { ChevronDown, X } from 'lucide-react'

import { cn } from '@/lib/utils'

interface FilterChipProps {
  icon?: React.ReactElement
  label: string
  selected?: boolean
  showCaret?: boolean
  onToggle?: (event?: React.MouseEvent<HTMLElement>) => void
  onDismiss?: () => void
}

const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(function FilterChip({
  icon,
  label,
  selected = false,
  showCaret = false,
  onToggle,
  onDismiss,
}: FilterChipProps, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={(event) => onToggle?.(event)}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        selected
          ? 'border-slate-500 bg-white/8 text-slate-100'
          : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700 hover:bg-slate-900',
        onToggle ? 'cursor-pointer' : 'cursor-default',
      )}
    >
      {icon ? <span className="flex shrink-0 items-center text-slate-400">{icon}</span> : null}
      <span>{label}</span>
      {showCaret && !onDismiss ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" /> : null}
      {onDismiss ? (
        <span
          aria-hidden="true"
          className="ml-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          onClick={(event) => {
            event.stopPropagation()
            onDismiss()
          }}
        >
          <X className="h-3 w-3" />
        </span>
      ) : null}
    </button>
  )
})

export default FilterChip
