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
        caption_label: 'text-sm font-medium text-slate-100',
        nav: 'flex items-center gap-1',
        button_previous: 'absolute left-1 inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800',
        button_next: 'absolute right-1 inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800',
        month_grid: 'w-full border-collapse space-y-1',
        weekdays: 'flex',
        weeks: 'mt-2 flex flex-col gap-2',
        weekday: 'w-9 text-[0.8rem] font-normal text-slate-400',
        week: 'flex w-full',
        day: 'h-9 w-9 p-0 text-center text-sm relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-slate-800/50 [&:has([aria-selected])]:bg-slate-800 first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20',
        day_button: 'h-9 w-9 rounded-md p-0 font-normal text-slate-100 aria-selected:opacity-100 hover:bg-slate-800',
        range_end: 'day-range-end',
        selected: 'bg-sky-600 text-white hover:bg-sky-600 focus:bg-sky-600',
        today: 'bg-slate-800 text-slate-100',
        outside: 'day-outside text-slate-500 opacity-50 aria-selected:bg-slate-800/50 aria-selected:text-slate-500 aria-selected:opacity-30',
        disabled: 'text-slate-600 opacity-50',
        range_middle: 'aria-selected:bg-slate-800 aria-selected:text-slate-100',
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

