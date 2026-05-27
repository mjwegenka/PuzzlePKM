import React from 'react'
import { ChevronDown, X } from 'lucide-react'

import { cn } from '@/lib/utils'

interface FilterChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onToggle'> {
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
  onClick,
  className,
  ...rest
}: FilterChipProps, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onToggle?.(event)
      }}
      className={cn(
        'inline-flex h-10 items-center gap-2 rounded-[10px] border px-4 text-xs font-medium tracking-normal transition-[background-color,border-color,color,box-shadow]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        selected
          ? 'border-[rgba(227,179,65,0.28)] bg-[var(--color-selected-fill-soft)] text-foreground shadow-none'
          : 'border-border bg-[var(--color-surface-control)]/88 text-muted-foreground hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)] hover:text-foreground',
        (onToggle || onClick) ? 'cursor-pointer' : 'cursor-default',
        className,
      )}
    >
      {icon ? <span className="flex shrink-0 items-center text-[var(--color-text-disabled)]">{icon}</span> : null}
      <span>{label}</span>
      {showCaret && !onDismiss ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-disabled)]" /> : null}
      {onDismiss ? (
        <span
          aria-hidden="true"
          className="ml-1 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-[var(--color-text-disabled)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
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
