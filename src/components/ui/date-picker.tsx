import * as React from 'react'
import * as Popover from '@radix-ui/react-popover'
import { CalendarIcon, XIcon } from 'lucide-react'
import { format, parseISO, isValid } from 'date-fns'

import { cn } from '@/lib/utils'
import { formatDatePretty } from '@/lib/dateUtils'
import { Calendar } from './calendar'

interface DatePickerProps {
  label: string
  value?: string
  onChange: (value: string) => void
  helperText?: string
  placeholder?: string
  allowClear?: boolean
  className?: string
}

export default function DatePicker({
  label,
  value = '',
  onChange,
  helperText,
  placeholder = 'Pick a date',
  allowClear = false,
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  const selectedDate = React.useMemo(() => {
    if (!value) return undefined
    const parsed = parseISO(value)
    return isValid(parsed) ? parsed : undefined
  }, [value])

  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="block text-sm font-medium text-[var(--color-text-primary)]">{label}</label>
      <div className="flex items-center gap-2">
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex h-10 w-full items-center justify-between rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] px-3 py-2 text-left text-sm text-[var(--color-text-primary)] shadow-none transition-colors hover:bg-[var(--color-surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--color-action-focus)] focus:ring-offset-2 focus:ring-offset-[var(--color-surface-app)]',
                !value && 'text-[var(--color-text-disabled)]',
              )}
            >
              <span>{value ? formatDatePretty(value) : placeholder}</span>
              <CalendarIcon className="h-4 w-4 shrink-0 text-[var(--color-text-disabled)]" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              sideOffset={8}
              align="start"
              className="z-50 rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-0 text-[var(--color-text-primary)] shadow-xl outline-none"
            >
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  onChange(date ? format(date, 'yyyy-MM-dd') : '')
                  setOpen(false)
                }}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {allowClear && value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-action-focus)] focus:ring-offset-2 focus:ring-offset-[var(--color-surface-app)]"
            aria-label={`Clear ${label.toLowerCase()}`}
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}
      </div>
      {helperText && <p className="text-xs text-[var(--color-text-disabled)]">{helperText}</p>}
    </div>
  )
}

