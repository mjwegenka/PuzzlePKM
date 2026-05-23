import React from 'react'
import { Box, Chip, Paper, Stack, Typography } from '@mui/material'
import NoteAddIcon from '@mui/icons-material/NoteAdd'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import RepeatIcon from '@mui/icons-material/Repeat'
import { getObjectColor } from '../../lib/objectColors'
import type { ObjectType } from '../../shared/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NoteCardData {
  id: string
  type: ObjectType
  /** Optional weekday label rendered above the primary title/date. */
  weekdayLabel?: string
  /**
   * Metadata label shown in the top caption row alongside the type icon.
   * Use this for contextual info like a formatted date for topic-notes or
   * habits. Leave undefined to show only the type icon + tags.
   */
  metadata?: string
  /** Primary title or date — rendered large and prominent (18–20 px). */
  title: string
  /** Body preview rendered as regular body text (~14 px). */
  snippet?: string
  /** Optional media thumbnail URL — shown at the bottom of the card. */
  mediaUrl?: string
  /** Tag display names shown as small chips in the metadata row. */
  tags: string[]
}

export interface NoteCardProps {
  card: NoteCardData
  isSelected?: boolean
  /** Called when the card is clicked. */
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  /** Accessible title / tooltip for the card root element. */
  title?: string
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const TYPE_LABELS: Partial<Record<ObjectType, string>> = {
  'topic-note': 'Note',
  'daily-note': 'Daily',
  'habit': 'Habit',
  'project': 'Project',
  'ref-material': 'Reference',
  'scripture': 'Scripture',
}

const CARD_BACKGROUND = '#0e2038'
const CARD_HOVER_BACKGROUND = '#122845'
const CARD_BORDER = '#1c3558'
const CARD_HOVER_BORDER = '#26466f'
const CARD_HOVER_SHADOW = '0 8px 18px rgba(3, 10, 21, 0.18)'
const CARD_TRANSITION = 'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease'

function TypeIcon({ type }: { type: ObjectType }) {
  const sx = { fontSize: 11 }
  if (type === 'topic-note') return <NoteAddIcon sx={sx} />
  if (type === 'daily-note') return <CalendarTodayIcon sx={sx} />
  if (type === 'habit') return <RepeatIcon sx={sx} />
  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Reusable card shell component.
 *
 * Content order: metadata → title → snippet → media
 *
 * - Metadata row  : type icon + type label + optional metadata string + tags (caption style, 11 px)
 * - Title row     : primary text/date (prominent, 19 px)
 * - Snippet row   : body preview text (~14 px)
 * - Media row     : image thumbnail (bottom, if mediaUrl is provided)
 */
export function NoteCard({ card, isSelected = false, onClick, title }: NoteCardProps) {
  const token = getObjectColor(card.type)
  const tags = card.tags ?? []
  const typeLabel = TYPE_LABELS[card.type] ?? card.type

  return (
    <Paper
      onClick={onClick}
      title={title}
      sx={{
        bgcolor: CARD_BACKGROUND,
        border: `1px solid ${isSelected ? token.accent : CARD_BORDER}`,
        boxShadow: isSelected
          ? `0 0 0 1px ${token.accent}, 0 0 10px ${token.selectionGlow}`
          : 'none',
        borderRadius: '10px',
        p: 2,
        cursor: onClick ? 'pointer' : 'default',
        transition: CARD_TRANSITION,
        breakInside: 'avoid',
        '&:hover': onClick
          ? {
              bgcolor: CARD_HOVER_BACKGROUND,
              borderColor: isSelected ? token.accent : CARD_HOVER_BORDER,
              boxShadow: isSelected
                ? `0 0 0 1px ${token.accent}, 0 0 10px ${token.selectionGlow}, ${CARD_HOVER_SHADOW}`
                : CARD_HOVER_SHADOW,
            }
          : {},
      }}
    >
      {/* 1. Metadata row — type icon + label + optional metadata string + tags */}
      <Stack
        direction="row"
        alignItems="center"
        flexWrap="wrap"
        gap={0.5}
        sx={{ mb: 0.75 }}
      >
        {/* Type badge */}
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: token.text, flexShrink: 0 }}>
          <TypeIcon type={card.type} />
          <Typography
            component="span"
            variant="metadata-caption"
            sx={{
              color: token.text,
              textTransform: 'uppercase',
            }}
          >
            {typeLabel}
          </Typography>
        </Stack>

        {/* Optional metadata string (e.g. formatted date for topic/habit) */}
        {card.metadata && (
          <Typography
            component="span"
            variant="metadata-caption"
            sx={{ color: '#4a6a8a' }}
          >
            · {card.metadata}
          </Typography>
        )}

        {/* Tag chips */}
        {tags.slice(0, 3).map((tag) => (
          <Chip
            key={tag}
            label={tag}
            size="small"
            sx={{ height: 16, fontSize: '9px', bgcolor: token.bg, color: token.text, border: `1px solid ${token.border}` }}
          />
        ))}
        {tags.length > 3 && (
          <Chip
            label={`+${tags.length - 3}`}
            size="small"
            sx={{ height: 16, fontSize: '9px', bgcolor: token.bg, color: token.text, border: `1px solid ${token.border}` }}
          />
        )}
      </Stack>

      <Stack
        alignItems="flex-start"
        spacing={card.weekdayLabel ? 0.25 : 0}
        sx={{ mb: card.snippet || card.mediaUrl ? 0.75 : 0 }}
      >
        {card.weekdayLabel && (
          <Typography
            variant="metadata-caption"
            sx={{
              color: 'accent.metadata',
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {card.weekdayLabel}
          </Typography>
        )}

        {/* 2. Title / date — large, prominent */}
        <Typography
          variant={card.type === 'daily-note' ? 'card-date' : 'card-title'}
          sx={{
            color: '#e4f0fb',
            wordBreak: 'break-word',
            width: '100%',
          }}
        >
          {card.title || '(untitled)'}
        </Typography>
      </Stack>

      {/* 3. Snippet — regular body text */}
      {card.snippet && (
        <Typography
          variant="snippet-body"
          sx={{
            color: '#6b8fae',
            wordBreak: 'break-word',
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            mb: card.mediaUrl ? 1 : 0,
          }}
        >
          {card.snippet}
        </Typography>
      )}

      {/* 4. Media thumbnail — at the bottom if present */}
      {card.mediaUrl && (
        <Box
          component="img"
          src={card.mediaUrl}
          alt=""
          sx={{
            width: '100%',
            borderRadius: '6px',
            objectFit: 'cover',
            maxHeight: 140,
            display: 'block',
          }}
        />
      )}
    </Paper>
  )
}

export default NoteCard
