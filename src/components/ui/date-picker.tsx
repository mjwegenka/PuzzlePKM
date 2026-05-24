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
      <label className="block text-sm font-medium text-slate-200">{label}</label>
      <div className="flex items-center gap-2">
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex h-10 w-full items-center justify-between rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-left text-sm text-slate-100 shadow-sm transition-colors hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-900',
                !value && 'text-slate-500',
              )}
            >
              <span>{value ? formatDatePretty(value) : placeholder}</span>
              <CalendarIcon className="h-4 w-4 shrink-0 text-slate-400" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              sideOffset={8}
              align="start"
              className="z-50 rounded-md border border-slate-700 bg-slate-950 p-0 text-slate-100 shadow-xl outline-none"
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
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-950 text-slate-300 transition-colors hover:bg-slate-900 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-900"
            aria-label={`Clear ${label.toLowerCase()}`}
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}
      </div>
      {helperText && <p className="text-xs text-slate-400">{helperText}</p>}
    </div>
  )
}

