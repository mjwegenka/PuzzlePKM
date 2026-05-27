import React, { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../ui/button'

interface CalendarViewProps {
  onDateSelect: (date: string) => void
  selectedDate?: string
  /** Dates that have an existing daily note (YYYY-MM-DD strings). */
  noteDates?: string[]
}

export default function CalendarView({ onDateSelect, selectedDate, noteDates = [] }: CalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date())

  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  }

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay()
  }

  const formatDate = (year: number, month: number, day: number) => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const days = []
  const daysInMonth = getDaysInMonth(currentMonth)
  const firstDay = getFirstDayOfMonth(currentMonth)
  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()

  // Empty slots for days before month starts
  for (let i = 0; i < firstDay; i++) {
    days.push(null)
  }

  // Days in month
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(day)
  }

  const isToday = (day: number | null) => {
    if (!day) return false
    const today = new Date()
    return day === today.getDate() &&
           month === today.getMonth() &&
           year === today.getFullYear()
  }

  const isSelected = (day: number | null) => {
    if (!day || !selectedDate) return false
    return selectedDate === formatDate(year, month, day)
  }

  const hasNote = (day: number | null) => {
    if (!day) return false
    return noteDates.includes(formatDate(year, month, day))
  }

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(year, month - 1, 1))
  }

  const handleNextMonth = () => {
    setCurrentMonth(new Date(year, month + 1, 1))
  }

  const handleToday = () => {
    setCurrentMonth(new Date())
  }

  return (
    <div className="flex h-full flex-col rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-2">
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
          </h2>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handlePrevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={handleToday} variant="outline">
              Today
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Day headers */}
        <div className="mb-1 grid grid-cols-7 gap-0.5">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayLabel) => (
            <div key={dayLabel} className="text-center text-xs font-semibold text-[var(--color-text-secondary)]">
              {dayLabel}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid flex-1 grid-cols-7 gap-0.5">
          {days.map((day, idx) => (
            <Button
              key={idx}
              disabled={!day}
              onClick={() => day && onDateSelect(formatDate(year, month, day))}
              variant={isSelected(day) ? 'secondary' : 'ghost'}
              className="relative aspect-square min-w-0 p-0 text-[var(--color-text-primary)]"
              style={{
                backgroundColor: isToday(day) ? 'var(--color-selected-fill-soft)' : undefined,
                borderColor: isToday(day) ? 'rgba(242, 203, 99, 0.18)' : undefined,
                fontWeight: isToday(day) ? 700 : 400,
              }}
            >
              {day}
              {hasNote(day) && !isSelected(day) ? (
                <span className="absolute bottom-[3px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[var(--color-accent-selected)]" />
              ) : null}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
