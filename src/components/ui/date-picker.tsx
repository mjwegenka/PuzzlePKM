import * as React from 'react'
import * as Popover from '@radix-ui/react-popover'
import { CalendarIcon, XIcon } from 'lucide-react'
import { format, parseISO, isValid } from 'date-fns'

import { cn } from '@/lib/utils'
import { formatDatePretty, parseDateQueryToISO } from '@/lib/dateUtils'
import { Calendar } from './calendar'

interface DatePickerProps {
  label: string
  labelClassName?: string
  value?: string
  onChange: (value: string) => void
  helperText?: string
  placeholder?: string
  allowClear?: boolean
  readOnly?: boolean
  className?: string
}

export default function DatePicker({
  label,
  labelClassName,
  value = '',
  onChange,
  helperText,
  placeholder = 'Pick a date',
  allowClear = false,
  readOnly = false,
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const [inputText, setInputText] = React.useState('')
  const [isFocused, setIsFocused] = React.useState(false)

  const selectedDate = React.useMemo(() => {
    if (!value) return undefined
    const parsed = parseISO(value)
    return isValid(parsed) ? parsed : undefined
  }, [value])

  function handleFocus() {
    setIsFocused(true)
    // Show the ISO date so the user can edit it directly
    setInputText(value || '')
  }

  function commit(raw: string) {
    setIsFocused(false)
    const trimmed = raw.trim()
    if (!trimmed) {
      onChange('')
      return
    }
    const iso = parseDateQueryToISO(trimmed)
    if (iso) {
      onChange(iso)
    }
    // if unparseable, leave the previous value unchanged
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      commit(inputText)
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      setIsFocused(false)
      e.currentTarget.blur()
    }
  }

  const displayValue = isFocused
    ? inputText
    : value
      ? (formatDatePretty(value) ?? value)
      : ''

  return (
    <div className={cn('space-y-2.5', className)}>
      <label className={cn('block text-sm font-medium text-[var(--color-text-primary)]', labelClassName)}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          {/* Editable / read-only text input */}
          <input
            type="text"
            value={displayValue}
            placeholder={readOnly ? '' : placeholder}
            readOnly={readOnly}
            onFocus={readOnly ? undefined : handleFocus}
            onChange={readOnly ? undefined : (e) => setInputText(e.target.value)}
            onBlur={readOnly ? undefined : (e) => commit(e.target.value)}
            onKeyDown={readOnly ? undefined : handleKeyDown}
            className={cn(
              'h-10 w-full rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] px-3 py-2 text-sm text-[var(--color-text-primary)] shadow-none transition-colors',
              'placeholder:text-[var(--color-text-disabled)]',
              !readOnly && 'pr-9 hover:bg-[var(--color-surface-hover)] focus:bg-[var(--color-surface-hover)]',
              !readOnly && 'focus:outline-none focus:ring-2 focus:ring-[var(--color-action-focus)] focus:ring-offset-2 focus:ring-offset-[var(--color-surface-app)]',
              readOnly && 'cursor-default select-text opacity-75',
            )}
          />

          {/* Calendar icon — only shown when not read-only */}
          {!readOnly && (
            <Popover.Root open={open} onOpenChange={setOpen}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Open date picker"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-text-disabled)] hover:text-[var(--color-text-secondary)] focus:outline-none"
                >
                  <CalendarIcon className="h-4 w-4 shrink-0" />
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
                    defaultMonth={selectedDate}
                    onSelect={(date) => {
                      onChange(date ? format(date, 'yyyy-MM-dd') : '')
                      setOpen(false)
                    }}
                    captionLayout="dropdown"
                    startMonth={new Date(2000, 0)}
                    endMonth={new Date(2040, 11)}
                  />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )}
        </div>

        {!readOnly && allowClear && value && (
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
      {helperText && <p className="pt-1 text-xs text-[var(--color-text-disabled)]">{helperText}</p>}
    </div>
  )
}
