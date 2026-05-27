import React from 'react'
import { CalendarDays, NotebookPen, Repeat } from 'lucide-react'
import type { ObjectType } from '@shared/types'
import { Badge } from './badge'
import { cn } from '@/lib/utils'
import { cardSpacingTokens } from '@/theme'

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
  onClick?: (e: React.MouseEvent<HTMLElement>) => void
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
  'tag': 'Tag',
}

const CARD_TRANSITION = 'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease'
const MARKDOWN_LINK_REGEX = /!\[([^]]*)]\(([^)\s]+)\)|\[([^]]+)]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g

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
          <a
            key={`${keyPrefix}-media-${start}`}
            href={safeHref}
            target="_blank"
            rel="noreferrer"
            className="italic underline"
            style={{ color: 'var(--color-accent-link)' }}
          >
            media: {label}
          </a>,
        )
      } else {
        nodes.push(<React.Fragment key={`${keyPrefix}-media-text-${start}`}>media: {label}</React.Fragment>)
      }
    } else if (linkHref && linkLabel) {
      const safeHref = getSafeHref(linkHref)
      const isMedia = isMediaHref(linkHref)
      if (safeHref) {
        nodes.push(
          <a
            key={`${keyPrefix}-link-${start}`}
            href={safeHref}
            target="_blank"
            rel="noreferrer"
            className={cn('underline', isMedia ? 'italic' : undefined)}
            style={{ color: 'var(--color-accent-link)' }}
          >
            {isMedia ? `media: ${linkLabel}` : linkLabel}
          </a>,
        )
      } else {
        nodes.push(<React.Fragment key={`${keyPrefix}-link-text-${start}`}>{linkLabel}</React.Fragment>)
      }
    } else if (inlineCode) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${start}`}
          className="rounded-sm px-0.5 font-mono"
          style={{ backgroundColor: 'var(--color-action-hover)', color: 'var(--color-accent-link)' }}
        >
          {inlineCode}
        </code>,
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
    <div className="grid gap-1">
      {lines.map((line, index) => {
        const trimmed = line.trim()
        const bulletMatch = /^\s*[-*+]\s+(.*)$/.exec(line)
        const orderedMatch = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
        const content = bulletMatch?.[1] ?? orderedMatch?.[2] ?? line

        if (!trimmed) return <div key={`line-${index}`} className="min-h-[1em]" />

        return (
          <div key={`line-${index}`} className="flex items-start gap-3">
            {bulletMatch && <span style={{ color: 'var(--color-accent-link)', minWidth: '0.75em' }}>•</span>}
            {orderedMatch && <span style={{ color: 'var(--color-accent-link)', minWidth: '1.35em' }}>{orderedMatch[1]}.</span>}
            <span className="min-w-0">
              {renderMarkdownInline(content, `line-${index}`)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function TypeIcon({ type }: { type: ObjectType }) {
  if (type === 'topic-note') return <NotebookPen className="h-3 w-3" />
  if (type === 'daily-note') return <CalendarDays className="h-3 w-3" />
  if (type === 'habit') return <Repeat className="h-3 w-3" />
  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Reusable card shell component.
 *
 * Content order: metadata → title → snippet → media
 *
 * - Metadata row  : type icon + type label + optional metadata string + tags (caption style, 12 px)
 * - Title row     : primary text/date (prominent, 19 px)
 * - Snippet row   : body preview text (~14 px)
 * - Media row     : image thumbnail (bottom, if mediaUrl is provided)
 */
export function NoteCard({ card, isSelected = false, onClick, title }: NoteCardProps) {
  const tags = card.tags ?? []
  const typeLabel = TYPE_LABELS[card.type] ?? card.type

  return (
    <div
      onClick={onClick}
      title={title}
      className={cn(
        'w-full break-inside-avoid rounded-[10px] border bg-[var(--color-surface-elevated)] text-left transition-[background-color,border-color,box-shadow]',
        onClick ? 'cursor-pointer hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-sunken)]' : 'cursor-default',
      )}
      style={{
        padding: cardSpacingTokens.cardPadding,
        borderColor: isSelected ? 'var(--color-accent-selected)' : 'var(--color-border-subtle)',
        boxShadow: isSelected ? '0 0 0 1px var(--color-accent-selected), 0 0 10px var(--color-action-focus)' : 'none',
        transition: CARD_TRANSITION,
      }}
    >
      {/* 1. Metadata row — type icon + label + optional metadata string + tags */}
      <div className="mb-3 flex flex-wrap items-center gap-0.5 text-[var(--color-text-disabled)]">
        {/* Type badge */}
        <div className="flex shrink-0 items-center gap-0.5 text-inherit">
          <TypeIcon type={card.type} />
          <span className="text-[11px] uppercase" style={{ color: 'inherit' }}>
            {typeLabel}
          </span>
        </div>

        {/* Optional metadata string (e.g. formatted date for topic/habit) */}
        {card.metadata && (
          <span className="text-[11px]" style={{ color: 'inherit' }}>
            · {card.metadata}
          </span>
        )}

        {/* Tag chips */}
        {tags.slice(0, 3).map((tag) => (
          <Badge
            key={tag}
            variant="outline"
            className="h-4 border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] px-1.5 text-[9px] text-[var(--color-text-secondary)]"
          >
            {tag}
          </Badge>
        ))}
        {tags.length > 3 && (
          <Badge
            variant="outline"
            className="h-4 border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] px-1.5 text-[9px] text-[var(--color-text-secondary)]"
          >
            +{tags.length - 3}
          </Badge>
        )}
      </div>

      <div className={cn('flex items-start', card.weekdayLabel ? 'flex-col gap-1' : 'flex-col')} style={{ marginBottom: card.snippet || card.mediaUrl ? '0.75rem' : 0 }}>
        {card.weekdayLabel && (
          <span
            className="text-[10px] font-bold uppercase tracking-[0.08em]"
            style={{ color: 'var(--color-accent-metadata)' }}
          >
            {card.weekdayLabel}
          </span>
        )}

        {/* 2. Title / date — large, prominent */}
        <span
          className={cn('w-full break-words text-[var(--color-text-primary)]', card.type === 'daily-note' ? 'text-[20px] font-bold' : 'text-[19px] font-semibold')}
        >
          {card.title || '(untitled)'}
        </span>
      </div>

      {/* 3. Snippet — regular body text */}
      {card.snippet && (
        <div
          className="block max-h-[5.6em] overflow-hidden break-words text-sm leading-5 text-[var(--color-text-secondary)]"
          style={{ marginBottom: card.mediaUrl ? '0.25rem' : 0 }}
        >
          <MarkdownSnippet text={card.snippet} />
        </div>
      )}

      {/* 4. Media thumbnail — at the bottom if present */}
      {card.mediaUrl && (
        <img
          src={card.mediaUrl}
          alt=""
          className="block max-h-[140px] w-full rounded-[6px] object-cover"
        />
      )}
    </div>
  )
}

export default NoteCard
