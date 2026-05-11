import { useEffect, useState } from 'react'
import { Box, List, ListItem, ListItemText, Paper, Stack, Typography } from '@mui/material'
import { useSearchParams } from 'react-router-dom'
import { getTodayDate } from '../lib/dateUtils'
import type { Habit } from '../shared/types'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Trash2 } from 'lucide-react'

export default function HabitsPage() {
  const [searchParams] = useSearchParams()
  const [date, setDate] = useState(getTodayDate())
  const [text, setText] = useState('')
  const [habits, setHabits] = useState<Habit[]>([])
  const [status, setStatus] = useState('')

  const loadHabits = async (targetDate: string) => {
    const res = await window.dropith.habit.list(targetDate)
    if (res.success && res.data) setHabits(res.data)
  }

  useEffect(() => {
    loadHabits(date)
  }, [date])

  useEffect(() => {
    const focusId = searchParams.get('focus')
    if (!focusId) return
    setHabits((current) => [...current].sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : 0)))
  }, [searchParams])

  const addHabit = async () => {
    if (!text.trim()) return
    const now = new Date().toISOString()
    const res = await window.dropith.habit.create({
      id: crypto.randomUUID(),
      text,
      date,
      tags: [],
      createdAt: now,
      updatedAt: now,
    })
    if (!res.success || !res.data) return
    setText('')
    setStatus(res.data.truncated ? 'Habit was trimmed to 255 characters.' : 'Habit added.')
    await loadHabits(date)
  }

  return (
    <Box sx={{ height: '100%', p: 2.5, overflowY: 'auto' }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>Habits</Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} fullWidth={false} />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder="Record a habit entry"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHabit(); } }}
        />
        <Button onClick={addHabit}>Add</Button>
      </Stack>
      {status && <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>{status}</Typography>}
      <List disablePadding>
        {habits.map((habit) => (
          <Paper key={habit.id} variant="outlined" sx={{ mb: 1 }}>
            <ListItem
              secondaryAction={
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    await window.dropith.habit.delete(habit.id)
                    await loadHabits(date)
                  }}
                  title="Delete habit"
                  aria-label="Delete habit"
                >
                  <Trash2 size={14} />
                </Button>
              }
            >
              <ListItemText primaryTypographyProps={{ variant: 'body2' }} primary={habit.text} />
            </ListItem>
          </Paper>
        ))}
      </List>
    </Box>
  )
}
