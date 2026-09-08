import { cn, Badge } from 'aslan-ui';
import React from 'react'
import { BookOpenText, CalendarDays, FileText, Folder, Hash, ListTodo, NotebookPen, Repeat, ScrollText } from 'lucide-react'
import type { ObjectType } from '@shared/types'
import { getObjectColor } from '@/lib/objectColors'
import { withAlpha } from '@/lib/colorUtils'

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * DEC-79: 'document' is a file inside a project or reference-material folder,
 * not an object in the knowledge base. It renders as a card so search results
 * can point at the file itself, but it is deliberately not an `ObjectType`.
 */
export type NoteCardType = ObjectType | 'document'

export interface NoteCardData {
  id: string
  type: NoteCardType
  /** Optional weekday label rendered above the primary title/date. */
  weekdayLabel?: string
  /**
   * Metadata label shown in the top caption row alongside the type icon.
   * Use this for contextual info like a formatted date for topic-notes or
   * habits. Leave undefined to show only the type icon + tags.
   */
  metadata?: string
  /** Whether metadata should use the warm accent treatment instead of the default metadata tone. */
  metadataAccent?: boolean
  /** Primary title or date — rendered large and prominent (18–20 px). */
  title: string
  /** Body preview rendered as regular body text (~14 px). */
  snippet?: string
  /** Optional media thumbnail URL — shown at the bottom of the card. */
  mediaUrl?: string
  /** Tag display names shown as small chips in the metadata row. */
  tags: string[]
  /** Hide rendered tag chips while retaining tags in the backing card payload. */
  hideTags?: boolean
  /** DEC-83: incomplete tasks written in this note, shown as a small chip. */
  openTaskCount?: number
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

const TYPE_LABELS: Partial<Record<NoteCardType, string>> = {
  'topic-note': 'Topic Note',
  'daily-note': 'Daily Note',
  'habit': 'Habit',
  'project': 'Project',
  'ref-material': 'Reference',
  'scripture': 'Scripture',
  'scripture-chapter': 'Chapter',
  'tag': 'Tag',
  'document': 'Document',
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

function MarkdownSnippet({ text, maxLines = 4 }: { text: string; maxLines?: number }) {
  const lines = text.split('\n')
  const visibleLines = lines.slice(0, maxLines)
  const wasTruncated = lines.length > maxLines

  return (
    <div className="grid gap-1">
      {visibleLines.map((line, index) => {
        const trimmed = line.trim()
        const bulletMatch = /^\s*[-*+]\s+(.*)$/.exec(line)
        const orderedMatch = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
        const baseContent = bulletMatch?.[1] ?? orderedMatch?.[2] ?? line
        const content = wasTruncated && index === visibleLines.length - 1
          ? `${baseContent.replace(/[\s.]+$/, '')}…`
          : baseContent

        if (!trimmed) return <div key={`line-${index}`} className="min-h-[1em]" />

        return (
          <div key={`line-${index}`} className="flex items-start gap-3">
            {bulletMatch && <span style={{ color: 'var(--color-accent-link)', minWidth: '0.75em' }}>•</span>}
            {orderedMatch && <span style={{ color: 'var(--color-accent-link)', minWidth: '1.35em' }}>{orderedMatch[1]}.</span>}
            <span className="min-w-0 break-words" style={{ overflowWrap: 'anywhere' }}>
              {renderMarkdownInline(content, `line-${index}`)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function TypeIcon({ type }: { type: NoteCardType }) {
  if (type === 'topic-note') return <NotebookPen className="h-3 w-3" />
  if (type === 'daily-note') return <CalendarDays className="h-3 w-3" />
  if (type === 'habit') return <Repeat className="h-3 w-3" />
  if (type === 'project') return <Folder className="h-3 w-3" />
  if (type === 'ref-material') return <BookOpenText className="h-3 w-3" />
  if (type === 'scripture') return <ScrollText className="h-3 w-3" />
  if (type === 'tag') return <Hash className="h-3 w-3" />
  if (type === 'document') return <FileText className="h-3 w-3" />
  return <NotebookPen className="h-3 w-3" />
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Reusable card shell component.
 *
 * Content order: title → metadata → snippet → media
 *
 * - Title row     : primary text/date (prominent, 19 px)
 * - Metadata row  : type icon + type label + optional weekday / metadata string + tags (caption style, 12 px)
 * - Snippet row   : body preview text (~14 px)
 * - Media row     : image thumbnail (bottom, if mediaUrl is provided)
 */
export function NoteCard({ card, isSelected = false, onClick, title }: NoteCardProps) {
  const tags = card.tags ?? []
  const visibleTags = card.hideTags || card.type === 'tag' ? [] : tags
  const typeLabel = TYPE_LABELS[card.type] ?? card.type
  const isTagCard = card.type === 'tag'
  const suppressMetadataDot = card.type === 'project' || card.type === 'topic-note' || card.type === 'ref-material'
  const typeColor = card.type === 'tag' ? undefined : getObjectColor(card.type).accent
  const contentToneClass = 'text-[var(--color-text-primary)]'
  const metaToneClass = isSelected ? 'text-[var(--color-accent-metadata)]' : 'text-[var(--color-text-disabled)]'
  const emphasizedMetadataClass = card.type === 'topic-note' || card.type === 'project'
    ? 'font-semibold uppercase tracking-[0.08em]'
    : undefined
  const metadataToneClass = card.metadataAccent ? 'text-[var(--color-accent-metadata)]' : 'text-inherit'
  const chipClassName = isSelected
    ? 'border-[rgba(242,203,99,0.14)] bg-[rgba(242,203,99,0.08)] text-[var(--color-text-secondary)]'
    : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]'

  return (
    <div
      onClick={onClick}
      title={title}
      className={cn(
        'w-full break-inside-avoid rounded-[14px] border text-left transition-[background-color,border-color,box-shadow] overflow-hidden select-none',
        onClick ? 'cursor-pointer hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-control)]' : 'cursor-default',
      )}
      style={{
        padding: '14px 16px',
        backgroundColor: isSelected ? 'var(--color-selected-fill-soft)' : 'var(--color-surface-elevated)',
        borderColor: isSelected ? 'rgba(242, 203, 99, 0.16)' : 'var(--color-border-subtle)',
        boxShadow: 'none',
        transition: CARD_TRANSITION,
      }}
    >
      {/* 1. Title / date — large, prominent */}
      <div style={{ marginBottom: '0.7rem' }}>
        <span
          className={cn('w-full break-words text-xl font-semibold leading-[1.25]', contentToneClass, card.type === 'tag' ? 'ui-tag-text' : undefined)}
          style={{
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 3,
            overflow: 'hidden',
          }}
        >
          {card.title || '(untitled)'}
        </span>
      </div>

      {/* 2. Metadata row — type icon + label + optional weekday / metadata string + tags */}
      <div className={cn('mb-2.5 flex flex-wrap items-center gap-1.5', metaToneClass)}>
        <div
          className={cn(
            'flex h-5 shrink-0 items-center gap-1 rounded-[8px] border px-2 leading-none [&_svg]:h-3 [&_svg]:w-3',
            card.type === 'tag' ? 'border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] text-[var(--color-text-secondary)]' : 'text-[var(--color-text-secondary)]',
          )}
          style={card.type === 'tag'
            ? undefined
            : {
                backgroundColor: withAlpha(typeColor ?? '#ffffff', 0.16),
                borderColor: withAlpha(typeColor ?? '#ffffff', 0.42),
              }}
        >
          <TypeIcon type={card.type} />
          <span className="ui-tag-text text-xs font-medium leading-none">{typeLabel}</span>
        </div>

        {card.weekdayLabel && (
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-accent-metadata)]">
            {card.weekdayLabel}
          </span>
        )}

        {card.metadata && (
          <span
            className={cn(
              'text-xs',
              isTagCard ? 'font-bold uppercase tracking-[0.08em] text-[var(--color-accent-metadata)]' : emphasizedMetadataClass,
              isTagCard ? undefined : metadataToneClass,
            )}
            style={{ color: card.metadataAccent || isTagCard ? undefined : 'inherit' }}
          >
            {isTagCard || suppressMetadataDot ? card.metadata : `· ${card.metadata}`}
          </span>
        )}

        {Boolean(card.openTaskCount) && (
          <Badge
            variant="outline"
            className={cn('h-5 rounded-[8px] px-2 text-xs font-semibold', chipClassName)}
            title={`${card.openTaskCount} open task${card.openTaskCount === 1 ? '' : 's'}`}
          >
            <ListTodo className="mr-1 h-3 w-3" />
            {card.openTaskCount}
          </Badge>
        )}

        {visibleTags.slice(0, 3).map((tag) => (
          <Badge
            key={tag}
            variant="outline"
            className={cn('ui-tag-text h-5 rounded-[8px] px-2 text-xs font-medium', chipClassName)}
          >
            {tag}
          </Badge>
        ))}
        {visibleTags.length > 3 && (
          <Badge
            variant="outline"
            className={cn('h-5 rounded-[8px] px-2 text-xs font-medium', chipClassName)}
          >
            +{visibleTags.length - 3}
          </Badge>
        )}
      </div>

      {/* 3. Snippet — regular body text */}
      {card.snippet && (
        <div
          className={cn('block break-words text-sm leading-[1.45] text-[var(--color-text-secondary)]')}
          style={{ marginTop: '0.375rem', marginBottom: card.mediaUrl ? '0.25rem' : 0, overflowWrap: 'anywhere' }}
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
