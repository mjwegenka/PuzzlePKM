import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker, type DayPickerProps } from 'react-day-picker'
import 'react-day-picker/style.css'

import { cn } from '../../lib/utils'

export type CalendarProps = DayPickerProps

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        root: 'rdp-root',
        months: 'flex flex-col sm:flex-row gap-4',
        month: 'space-y-4',
        month_caption: 'relative flex items-center justify-center pt-1',
        caption_label: 'text-sm font-medium text-[var(--color-text-primary)]',
        nav: 'flex items-center gap-1',
        button_previous: 'absolute left-1 inline-flex h-7 w-7 items-center justify-center rounded-[10px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
        button_next: 'absolute right-1 inline-flex h-7 w-7 items-center justify-center rounded-[10px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
        month_grid: 'w-full border-collapse space-y-1',
        weekdays: 'flex',
        weeks: 'mt-2 flex flex-col gap-2',
        weekday: 'w-9 text-[0.8rem] font-normal text-[var(--color-text-disabled)]',
        week: 'flex w-full',
        day: 'h-9 w-9 p-0 text-center text-sm relative [&:has([aria-selected].day-range-end)]:rounded-r-[10px] [&:has([aria-selected].day-outside)]:bg-[var(--color-surface-hover)]/70 [&:has([aria-selected])]:bg-[var(--color-surface-hover)] first:[&:has([aria-selected])]:rounded-l-[10px] last:[&:has([aria-selected])]:rounded-r-[10px] focus-within:relative focus-within:z-20',
        day_button: 'h-9 w-9 rounded-[10px] p-0 font-normal text-[var(--color-text-primary)] aria-selected:opacity-100 hover:bg-[var(--color-surface-hover)]',
        range_end: 'day-range-end',
        selected: 'bg-[var(--color-selected-fill-soft)] text-[var(--color-text-primary)] border border-[rgba(242,203,99,0.18)] hover:bg-[var(--color-selected-fill-soft)] focus:bg-[var(--color-selected-fill-soft)]',
        today: 'bg-[var(--color-surface-control)] text-[var(--color-text-primary)]',
        outside: 'day-outside text-[var(--color-text-disabled)] opacity-50 aria-selected:bg-[var(--color-surface-hover)] aria-selected:text-[var(--color-text-disabled)] aria-selected:opacity-40',
        disabled: 'text-[var(--color-text-disabled)] opacity-40',
        range_middle: 'aria-selected:bg-[var(--color-surface-hover)] aria-selected:text-[var(--color-text-primary)]',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: iconClassName, ...iconProps }) =>
          orientation === 'left' ? (
            <ChevronLeft className={cn('h-4 w-4', iconClassName)} {...iconProps} />
          ) : (
            <ChevronRight className={cn('h-4 w-4', iconClassName)} {...iconProps} />
          ),
      }}
      {...props}
    />
  )
}

export default Calendar

