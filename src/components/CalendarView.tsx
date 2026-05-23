import React, { useState } from 'react';
import {
  Box,
  Button,
  Paper,
  Stack,
  Typography,
  IconButton,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

interface CalendarViewProps {
  onDateSelect: (date: string) => void;
  selectedDate?: string;
  /** Dates that have an existing daily note (YYYY-MM-DD strings). */
  noteDates?: string[];
}

export default function CalendarView({ onDateSelect, selectedDate, noteDates = [] }: CalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const formatDate = (year: number, month: number, day: number) => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const days = [];
  const daysInMonth = getDaysInMonth(currentMonth);
  const firstDay = getFirstDayOfMonth(currentMonth);
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  // Empty slots for days before month starts
  for (let i = 0; i < firstDay; i++) {
    days.push(null);
  }

  // Days in month
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(day);
  }

  const isToday = (day: number | null) => {
    if (!day) return false;
    const today = new Date();
    return day === today.getDate() &&
           month === today.getMonth() &&
           year === today.getFullYear();
  };

  const isSelected = (day: number | null) => {
    if (!day || !selectedDate) return false;
    return selectedDate === formatDate(year, month, day);
  };

  const hasNote = (day: number | null) => {
    if (!day) return false;
    return noteDates.includes(formatDate(year, month, day));
  };

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(year, month + 1, 1));
  };

  const handleToday = () => {
    setCurrentMonth(new Date());
  };

  return (
    <Paper sx={{ p: 2, bgcolor: '#1a1c1f', border: '1px solid rgba(255,255,255,0.09)', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack spacing={2} sx={{ flex: 1 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
          </Typography>
          <Stack direction="row" spacing={1}>
            <IconButton size="small" onClick={handlePrevMonth}>
              <ChevronLeftIcon />
            </IconButton>
            <Button size="small" onClick={handleToday} variant="outlined">
              Today
            </Button>
            <IconButton size="small" onClick={handleNextMonth}>
              <ChevronRightIcon />
            </IconButton>
          </Stack>
        </Stack>

        {/* Day headers */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, mb: 1 }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayLabel) => (
            <Box key={dayLabel} sx={{ textAlign: 'center', fontSize: '12px', fontWeight: 600, color: '#b8bec8' }}>
              {dayLabel}
            </Box>
          ))}
        </Box>

        {/* Calendar grid */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, flex: 1 }}>
          {days.map((day, idx) => (
            <Button
              key={idx}
              disabled={!day}
              onClick={() => day && onDateSelect(formatDate(year, month, day))}
              variant={isSelected(day) ? 'contained' : 'text'}
              sx={{
                aspectRatio: '1',
                p: 0,
                minWidth: 'unset',
                position: 'relative',
                bgcolor: isToday(day) ? 'rgba(79,143,237,0.12)' : 'transparent',
                borderColor: isToday(day) ? 'rgba(79,143,237,0.45)' : 'transparent',
                color: !day ? 'transparent' : '#eceff3',
                fontWeight: isToday(day) ? 700 : 400,
                '&:hover': !day ? {} : {
                  bgcolor: 'rgba(79,143,237,0.2)',
                },
                // Note dot indicator
                '&::after': hasNote(day) && !isSelected(day) ? {
                  content: '""',
                  position: 'absolute',
                  bottom: '3px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '4px',
                  height: '4px',
                  borderRadius: '50%',
                  bgcolor: '#4f8fed',
                } : {},
              }}
            >
              {day}
            </Button>
          ))}
        </Box>
      </Stack>
    </Paper>
  );
}


