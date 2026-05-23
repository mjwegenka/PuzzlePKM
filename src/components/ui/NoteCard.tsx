import React from 'react'
import { Box, Chip, Paper, Stack, Typography } from '@mui/material'
import NoteAddIcon from '@mui/icons-material/NoteAdd'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import RepeatIcon from '@mui/icons-material/Repeat'
import type { ObjectType } from '../../shared/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NoteCardData {
  id: string
  type: ObjectType
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

const CARD_HOVER_SHADOW = '0 8px 18px rgba(3, 10, 21, 0.18)'
const CARD_TRANSITION = 'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease'
const MARKDOWN_LINK_REGEX = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g

function isMediaHref(value: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico|mp4|mov|webm|m4v|mp3|wav|ogg)$/i.test(value)
}

function getSafeHref(rawHref: string): string | null {
  const href = rawHref.trim()
  if (!href) return null
  if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) return href
  try {
    const parsed = new URL(href)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') return href
  } catch {
    return null
  }
  return null
}

function renderMarkdownInline(text: string, keyPrefix: string): React.ReactNode[] {
  if (!text) return []
  const nodes: React.ReactNode[] = []
  let lastIndex = 0

  for (const match of text.matchAll(MARKDOWN_LINK_REGEX)) {
    const start = match.index ?? 0
    if (start > lastIndex) {
      nodes.push(<React.Fragment key={`${keyPrefix}-text-${lastIndex}`}>{text.slice(lastIndex, start)}</React.Fragment>)
    }

    const [fullMatch, imageAlt, imageHref, linkLabel, linkHref, inlineCode, boldA, boldB, italicA, italicB] = match
    if (imageHref) {
      const safeHref = getSafeHref(imageHref)
      const label = imageAlt || imageHref
      if (safeHref) {
        nodes.push(
          <Box
            key={`${keyPrefix}-media-${start}`}
            component="a"
            href={safeHref}
            target="_blank"
            rel="noreferrer"
            sx={{ color: '#7dbad6', textDecoration: 'underline', fontStyle: 'italic' }}
          >
            media: {label}
          </Box>,
        )
      } else {
        nodes.push(<React.Fragment key={`${keyPrefix}-media-text-${start}`}>media: {label}</React.Fragment>)
      }
    } else if (linkHref && linkLabel) {
      const safeHref = getSafeHref(linkHref)
      const isMedia = isMediaHref(linkHref)
      if (safeHref) {
        nodes.push(
          <Box
            key={`${keyPrefix}-link-${start}`}
            component="a"
            href={safeHref}
            target="_blank"
            rel="noreferrer"
            sx={{ color: '#7dbad6', textDecoration: 'underline', fontStyle: isMedia ? 'italic' : 'normal' }}
          >
            {isMedia ? `media: ${linkLabel}` : linkLabel}
          </Box>,
        )
      } else {
        nodes.push(<React.Fragment key={`${keyPrefix}-link-text-${start}`}>{linkLabel}</React.Fragment>)
      }
    } else if (inlineCode) {
      nodes.push(
        <Box
          key={`${keyPrefix}-code-${start}`}
          component="code"
          sx={{ px: 0.5, borderRadius: 0.5, bgcolor: 'rgba(125,186,214,0.14)', color: '#c8e4f5', fontFamily: 'monospace' }}
        >
          {inlineCode}
        </Box>,
      )
    } else if (boldA || boldB) {
      nodes.push(<strong key={`${keyPrefix}-bold-${start}`}>{boldA || boldB}</strong>)
    } else if (italicA || italicB) {
      nodes.push(<em key={`${keyPrefix}-italic-${start}`}>{italicA || italicB}</em>)
    } else {
      nodes.push(<React.Fragment key={`${keyPrefix}-raw-${start}`}>{fullMatch}</React.Fragment>)
    }

    lastIndex = start + fullMatch.length
  }

  if (lastIndex < text.length) {
    nodes.push(<React.Fragment key={`${keyPrefix}-text-end`}>{text.slice(lastIndex)}</React.Fragment>)
  }

  return nodes
}

function MarkdownSnippet({ text }: { text: string }) {
  const lines = text.split('\n')

  return (
    <Box sx={{ display: 'grid', gap: 0.25 }}>
      {lines.map((line, index) => {
        const trimmed = line.trim()
        const bulletMatch = /^\s*[-*+]\s+(.*)$/.exec(line)
        const orderedMatch = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
        const content = bulletMatch?.[1] ?? orderedMatch?.[2] ?? line

        if (!trimmed) return <Box key={`line-${index}`} sx={{ minHeight: '1em' }} />

        return (
          <Box key={`line-${index}`} sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
            {bulletMatch && <Box component="span" sx={{ color: '#7dbad6', minWidth: '0.75em' }}>•</Box>}
            {orderedMatch && <Box component="span" sx={{ color: '#7dbad6', minWidth: '1.35em' }}>{orderedMatch[1]}.</Box>}
            <Box component="span" sx={{ minWidth: 0 }}>
              {renderMarkdownInline(content, `line-${index}`)}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

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
  const tags = card.tags ?? []
  const typeLabel = TYPE_LABELS[card.type] ?? card.type

  return (
    <Paper
      onClick={onClick}
      title={title}
      sx={(theme) => ({
        bgcolor: theme.palette.surface.elevated,
        border: `1px solid ${isSelected ? theme.palette.accent.selected : theme.palette.border.subtle}`,
        boxShadow: isSelected
          ? `0 0 0 1px ${theme.palette.accent.selected}, 0 0 10px ${theme.palette.action.focus}`
          : 'none',
        borderRadius: '10px',
        p: 2,
        cursor: onClick ? 'pointer' : 'default',
        transition: CARD_TRANSITION,
        breakInside: 'avoid',
        '&:hover': onClick
          ? {
              bgcolor: theme.palette.surface.sunken,
              borderColor: isSelected ? theme.palette.accent.selected : theme.palette.border.strong,
              boxShadow: isSelected
                ? `0 0 0 1px ${theme.palette.accent.selected}, 0 0 10px ${theme.palette.action.focus}, ${CARD_HOVER_SHADOW}`
                : CARD_HOVER_SHADOW,
            }
          : {},
      })}
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
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: 'text.secondary', flexShrink: 0 }}>
          <TypeIcon type={card.type} />
          <Typography
            component="span"
            variant="metadata-caption"
            sx={{
              color: 'text.secondary',
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
            sx={{ color: 'accent.metadata' }}
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
            sx={{
              height: 16,
              fontSize: '9px',
              bgcolor: 'surface.sunken',
              color: 'text.secondary',
              border: '1px solid',
              borderColor: 'border.subtle',
            }}
          />
        ))}
        {tags.length > 3 && (
          <Chip
            label={`+${tags.length - 3}`}
            size="small"
            sx={{
              height: 16,
              fontSize: '9px',
              bgcolor: 'surface.sunken',
              color: 'text.secondary',
              border: '1px solid',
              borderColor: 'border.subtle',
            }}
          />
        )}
      </Stack>

      {/* 2. Title / date — large, prominent */}
      <Typography
        variant={card.type === 'daily-note' ? 'card-date' : 'card-title'}
        sx={{
          color: 'text.primary',
          wordBreak: 'break-word',
          mb: card.snippet || card.mediaUrl ? 0.75 : 0,
        }}
      >
        {card.title || '(untitled)'}
      </Typography>

      {/* 3. Snippet — regular body text */}
      {card.snippet && (
        <Box
          sx={{
            color: 'text.secondary',
            wordBreak: 'break-word',
            display: 'block',
            overflow: 'hidden',
            maxHeight: '5.6em',
            lineHeight: 1.4,
            mb: card.mediaUrl ? 1 : 0,
          }}
        >
          <MarkdownSnippet text={card.snippet} />
        </Box>
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
