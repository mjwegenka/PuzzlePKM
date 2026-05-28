import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Bold,
  Code2,
  Heading2,
  Info,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Maximize2,
  Minimize2,
  Quote,
  Strikethrough,
  Underline as UnderlineIcon,
} from 'lucide-react'
import type { AnyExtension } from '@tiptap/core'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Blockquote from '@tiptap/extension-blockquote'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import CharacterCount from '@tiptap/extension-character-count'
import { marked } from 'marked'
import TurndownService from 'turndown'
import { invoke } from '@tauri-apps/api/core'
import MentionPopup, { type MentionOption } from './MentionPopup'
import { searchObjects } from '../../lib/cliService'
import type { NoteBlock } from '../../shared/types'
import { cn } from '../../lib/utils'
import { Textarea } from '../ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'

interface RichMarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  blocks?: NoteBlock[]
  onBlocksChange?: (blocks: NoteBlock[]) => void
  label: string
  placeholder?: string
  mentionEnabled?: boolean
  resolveMentionHref?: (option: MentionOption) => string | Promise<string>
  maxLength?: number
  onShiftClickLink?: (href: string, options?: { forceNewTab?: boolean }) => void | Promise<void>
}

type AdmonitionType = 'note' | 'tip' | 'important' | 'warn' | 'caution'

const ADMONITION_OPTIONS: Array<{ value: AdmonitionType; label: string }> = [
  { value: 'note', label: 'Note' },
  { value: 'tip', label: 'Tip' },
  { value: 'important', label: 'Important' },
  { value: 'warn', label: 'Warn' },
  { value: 'caution', label: 'Caution' },
]

function capitalize(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

marked.setOptions({
  gfm: true,
  breaks: true,
})

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
})

turndown.addRule('tightLineBreaks', {
  filter: ['br'],
  replacement: () => '  \n',
})

const ADMONITION_MARKER_RE = /^\[!([A-Za-z0-9_-]+)]([+-])?(?:\s+(.*))?$/
const BLANK_LINE_MARKER = '<!--puzzlepkm-blank-line-->'

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

function normalizeBlockquoteContent(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>\n?/gi, '\n')
}

function normalizeBlockquoteMarkdown(content: string): string {
  return normalizeBlockquoteContent(content)
    .replace(/^\n+|\n+$/g, '')
    .replace(/^/gm, '> ')
}

function normalizeAdmonitionMarker(line: string): string {
  return line
    .replaceAll('\\[', '[')
    .replaceAll('\\]', ']')
    .trim()
}

function parseAdmonitionMarker(line: string): { type: string; title: string } | null {
  const match = ADMONITION_MARKER_RE.exec(normalizeAdmonitionMarker(line))
  if (!match) return null
  return {
    type: match[1].toLowerCase(),
    title: (match[3] ?? '').trim(),
  }
}

function serializeAdmonitionBlockquote(content: string): string | null {
  const normalized = normalizeBlockquoteContent(content)
  const lines = normalized.split('\n').map((line) => line.trimEnd())
  const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0)
  if (firstNonEmptyIndex < 0) return null

  const marker = parseAdmonitionMarker(lines[firstNonEmptyIndex])
  if (!marker) return null

  const outputLines = lines.map((line, index) =>
    index === firstNonEmptyIndex ? `[!${marker.type.toUpperCase()}]${marker.title ? ` ${marker.title}` : ''}` : line,
  )
  return normalizeBlockquoteMarkdown(outputLines.join('\n'))
}

function isQuoteLine(line: string): boolean {
  return /^\s*>/.test(line)
}

function stripQuotePrefix(line: string): string {
  return line.replace(/^\s*>\s?/, '')
}

function transformAdmonitionMarkdownToHtml(markdown: string): string {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n')
  const segments: string[] = []
  const buffer: string[] = []
  let foundAdmonition = false

  const flushBuffer = () => {
    const chunk = buffer.join('\n').trimEnd()
    if (chunk) segments.push(chunk)
    buffer.length = 0
  }

  for (let i = 0; i < lines.length; ) {
    const line = lines[i] ?? ''
    if (isQuoteLine(line)) {
      const quoteLines: string[] = []
      let j = i
      while (j < lines.length) {
        const candidate = lines[j] ?? ''
        if (candidate.trim().length === 0 || isQuoteLine(candidate)) {
          quoteLines.push(candidate)
          j += 1
          continue
        }
        break
      }

      const innerLines = quoteLines.map(stripQuotePrefix)
      const firstNonEmptyIndex = innerLines.findIndex((innerLine) => innerLine.trim().length > 0)
      const marker = firstNonEmptyIndex >= 0 ? parseAdmonitionMarker(innerLines[firstNonEmptyIndex] ?? '') : null
      if (marker) {
        foundAdmonition = true
        flushBuffer()

        const bodyMarkdown = innerLines
          .slice(firstNonEmptyIndex + 1)
          .join('\n')
          .replace(/^\n+|\n+$/g, '')
        const bodyHtml = bodyMarkdown.trim() ? marked.parse(bodyMarkdown) as string : '<p></p>'
        const labelText = marker.title ? `${marker.type.toUpperCase()} ${marker.title}` : marker.type.toUpperCase()

        segments.push([
          `<blockquote data-admonition-type="${escapeAttribute(marker.type)}" data-admonition-label="${escapeAttribute(labelText)}">`,
          bodyHtml,
          `</blockquote>`,
        ].join('\n'))
        i = j
        continue
      }
    }

    buffer.push(line)
    i += 1
  }

  flushBuffer()
  if (!foundAdmonition) return String(markdown ?? '')
  return segments.join('\n\n')
}

turndown.addRule('blockquotePreserveAdmonitions', {
  filter: ['blockquote'],
  replacement: (content, node) => {
    if (!(node instanceof HTMLElement)) {
      const admonition = serializeAdmonitionBlockquote(content)
      return `\n\n${admonition ?? normalizeBlockquoteMarkdown(content)}\n\n`
    }

    const element = node

    const admonitionType = element.getAttribute('data-admonition-type')?.trim()
    if (!admonitionType) {
      const admonition = serializeAdmonitionBlockquote(content)
      return `\n\n${admonition ?? normalizeBlockquoteMarkdown(content)}\n\n`
    }

    const bodyMarkdown = turndown.turndown(element.innerHTML).trimEnd()
    const markerLine = `[!${admonitionType.toUpperCase()}]`
    if (!bodyMarkdown) {
      return `\n\n> ${markerLine}\n\n`
    }

    const bodyLines = bodyMarkdown.split('\n').map((line) => (line.trim().length > 0 ? `> ${line}` : '>')).join('\n')
    return `\n\n> ${markerLine}\n${bodyLines}\n\n`
  },
})

function normalizeEditorHtmlForMarkdown(html: string): string {
  // Preserve visual blank lines by keeping empty paragraphs as explicit breaks.
  return html.replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '<p><br></p>')
}

function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) return '<p></p>'
  const withBlankLineHtml = String(markdown ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (line.trim() === BLANK_LINE_MARKER ? '<p data-puzzlepkm-blank-line="true"><br></p>' : line))
    .join('\n')
  return marked.parse(transformAdmonitionMarkdownToHtml(withBlankLineHtml)) as string
}

function htmlToMarkdown(html: string): string {
  const normalizedHtml = normalizeEditorHtmlForMarkdown(html)
  const markdown = turndown.turndown(normalizedHtml)
    .replace(/\r\n/g, '\n')
    // Turndown serializes empty paragraphs as a standalone "  " line; keep
    // those as explicit markers so marked won't collapse them on reload.
    .replace(/^[ \t]{2}$/gm, BLANK_LINE_MARKER)
  return markdown === '\n' ? '' : markdown
}

function fallbackBlockId(index: number): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(16)}${index.toString(16).padStart(2, '0')}`
  return `blk-${random.slice(0, 12).padEnd(12, '0')}`
}

function splitMarkdownIntoParagraphs(markdown: string): string[] {
  const raw = String(markdown ?? '')
    .replace(/\r\n/g, '\n')
    .trimEnd()
  if (!raw) return []

  // Split on paragraph boundaries while keeping empty segments so that
  // intentional blank lines survive round-trips through saved block data.
  return raw.split('\n\n').map((paragraph) => paragraph.trimEnd())
}

function reconcileBlocksWithMarkdown(prevBlocks: NoteBlock[], markdown: string): NoteBlock[] {
  const nextParagraphs = splitMarkdownIntoParagraphs(markdown)
  if (nextParagraphs.length === 0) return []

  const normalizedPrev = prevBlocks
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((block, index) => ({
      blockId: block.blockId || fallbackBlockId(index),
      position: index,
      contentMarkdown: block.contentMarkdown ?? '',
    }))

  const usedPrev = new Set<number>()
  const nextBlocks: NoteBlock[] = new Array(nextParagraphs.length)

  for (let i = 0; i < nextParagraphs.length; i += 1) {
    const paragraph = nextParagraphs[i]
    const exactMatchIdx = normalizedPrev.findIndex(
      (block, idx) => !usedPrev.has(idx) && block.contentMarkdown === paragraph,
    )
    if (exactMatchIdx >= 0) {
      usedPrev.add(exactMatchIdx)
      nextBlocks[i] = {
        blockId: normalizedPrev[exactMatchIdx].blockId,
        position: i,
        contentMarkdown: paragraph,
      }
    }
  }

  for (let i = 0; i < nextParagraphs.length; i += 1) {
    if (nextBlocks[i]) continue
    const paragraph = nextParagraphs[i]
    const positionalMatchIdx = normalizedPrev.findIndex(
      (block, idx) => !usedPrev.has(idx) && block.position >= i,
    )

    if (positionalMatchIdx >= 0) {
      usedPrev.add(positionalMatchIdx)
      nextBlocks[i] = {
        blockId: normalizedPrev[positionalMatchIdx].blockId,
        position: i,
        contentMarkdown: paragraph,
      }
      continue
    }

    const firstUnusedIdx = normalizedPrev.findIndex((_, idx) => !usedPrev.has(idx))
    if (firstUnusedIdx >= 0) {
      usedPrev.add(firstUnusedIdx)
      nextBlocks[i] = {
        blockId: normalizedPrev[firstUnusedIdx].blockId,
        position: i,
        contentMarkdown: paragraph,
      }
      continue
    }

    nextBlocks[i] = {
      blockId: fallbackBlockId(i),
      position: i,
      contentMarkdown: paragraph,
    }
  }

  return nextBlocks
}

function areBlocksEqual(left: NoteBlock[], right: NoteBlock[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (
      left[i].blockId !== right[i].blockId ||
      left[i].position !== right[i].position ||
      left[i].contentMarkdown !== right[i].contentMarkdown
    ) {
      return false
    }
  }
  return true
}

interface ToolbarButtonProps {
  title: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}

function ToolbarButton({ title, active, onClick, children }: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={title}
        onClick={onClick}
          className={cn(
            'flex h-[30px] w-[30px] items-center justify-center rounded-[10px] border text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-action-hover)] hover:text-[var(--color-text-primary)]',
            active
              ? 'border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] text-[var(--color-text-primary)]'
              : 'border-transparent bg-transparent',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  )
}

function findAnchorTarget(target: EventTarget | null): HTMLAnchorElement | null {
  if (!target) return null
  if (target instanceof HTMLAnchorElement) return target
  if (target instanceof HTMLElement) return target.closest('a[href]') as HTMLAnchorElement | null
  if (target instanceof Text) return target.parentElement?.closest('a[href]') as HTMLAnchorElement | null
  return null
}

function isExternalHttpUrl(href: string): boolean {
  try {
    const parsed = new URL(href)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export default function RichMarkdownEditor({
  value,
  onChange,
  blocks,
  onBlocksChange,
  label,
  placeholder,
  mentionEnabled = false,
  resolveMentionHref,
  maxLength,
  onShiftClickLink,
}: RichMarkdownEditorProps) {
  const lastMarkdownRef = useRef(value)
  const lastBlocksRef = useRef<NoteBlock[]>(blocks ?? reconcileBlocksWithMarkdown([], value))
  const editorRef = useRef<Editor | null>(null)
  const isApplyingExternalValueRef = useRef(false)
  const mentionRangeRef = useRef<{ from: number; to: number } | null>(null)
  const lastHandledLinkRef = useRef<{ href: string; at: number } | null>(null)
  const markdownTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const previousMarkdownViewRef = useRef(false)
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionOptions, setMentionOptions] = useState<MentionOption[]>([])
  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0)
  const [mentionPosition, setMentionPosition] = useState<{ top: number; left: number } | null>(null)
  const [showMarkdownView, setShowMarkdownView] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [markdownPreview, setMarkdownPreview] = useState(value)

  const commitMarkdownChange = useCallback((nextMarkdown: string) => {
    const normalizedMarkdown = String(nextMarkdown ?? '').replace(/\r\n/g, '\n')
    if (normalizedMarkdown === lastMarkdownRef.current) return

    lastMarkdownRef.current = normalizedMarkdown
    setMarkdownPreview(normalizedMarkdown)
    const nextBlocks = reconcileBlocksWithMarkdown(lastBlocksRef.current, normalizedMarkdown)
    if (!areBlocksEqual(nextBlocks, lastBlocksRef.current)) {
      lastBlocksRef.current = nextBlocks
      onBlocksChange?.(nextBlocks)
    }
    onChange(normalizedMarkdown)
  }, [onBlocksChange, onChange])

  const extensions = useMemo<AnyExtension[]>(() => [
      Blockquote.extend({
        addAttributes() {
          return {
            admonitionType: {
              default: null,
              parseHTML: (element) => (element as HTMLElement).getAttribute('data-admonition-type'),
              renderHTML: (attributes) => {
                const type = String(attributes.admonitionType ?? '').trim()
                return type ? { 'data-admonition-type': type } : {}
              },
            },
            admonitionLabel: {
              default: null,
              parseHTML: (element) => (element as HTMLElement).getAttribute('data-admonition-label'),
              renderHTML: (attributes) => {
                const label = String(attributes.admonitionLabel ?? '').trim()
                return label ? { 'data-admonition-label': label } : {}
              },
            },
          }
        },
        renderHTML({ HTMLAttributes }) {
          return ['blockquote', HTMLAttributes, 0]
        },
      }),
      StarterKit.configure({
        blockquote: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
      }),
      Placeholder.configure({
        placeholder: placeholder ?? '',
      }),
      Underline,
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      ...(typeof maxLength === 'number'
        ? [CharacterCount.configure({ limit: maxLength })]
        : []),
    ], [maxLength, placeholder])

  const closeMention = useCallback(() => {
    setMentionActive(false)
    setMentionOptions([])
    setMentionSelectedIdx(0)
    setMentionPosition(null)
    mentionRangeRef.current = null
  }, [])

  const updateMentionState = useCallback((editor: Editor) => {
    if (!mentionEnabled) {
      closeMention()
      return
    }

    const { from, empty } = editor.state.selection
    if (!empty) {
      closeMention()
      return
    }

    const textBeforeCursor = editor.state.doc.textBetween(0, from, '\n', '\0')
    const match = textBeforeCursor.match(/(?:^|[\s(])@([^\s@()]*)$/)

    if (!match) {
      closeMention()
      return
    }

    const query = match[1] ?? ''
    const start = from - query.length - 1
    const coords = editor.view.coordsAtPos(from)
    mentionRangeRef.current = { from: start, to: from }
    setMentionQuery(query)
    setMentionActive(true)
    setMentionPosition({ top: coords.bottom + 4, left: coords.left + 8 })
  }, [closeMention, mentionEnabled])

  const openLinkedObject = useCallback((href: string, options?: { forceNewTab?: boolean }) => {
    const now = Date.now()
    const lastHandled = lastHandledLinkRef.current
    if (lastHandled && lastHandled.href === href && now - lastHandled.at < 250) return
    lastHandledLinkRef.current = { href, at: now }
    void Promise.resolve(onShiftClickLink?.(href, options)).catch(() => {
      // ObjectEditor surfaces navigation errors; suppress unhandled rejection here.
    })
  }, [onShiftClickLink])

   const openExternalLink = useCallback((href: string) => {
     const now = Date.now()
     const key = `external:${href}`
     const lastHandled = lastHandledLinkRef.current
     if (lastHandled && lastHandled.href === key && now - lastHandled.at < 250) return
     lastHandledLinkRef.current = { href: key, at: now }
     if (typeof window === 'undefined') return

     // Try to use Tauri's invoke command to open URLs via desktop
     void invoke<void>('open_url', { url: href }).catch(() => {
       // Fallback to window.open for web environments where Tauri is not available
       if (typeof window !== 'undefined') {
         window.open(href, '_blank', 'noopener,noreferrer')
       }
     })
   }, [])

  const handleModifiedLinkClick = useCallback((event: { type: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; target: EventTarget | null; preventDefault: () => void; stopPropagation?: () => void }) => {
    const anchor = findAnchorTarget(event.target)
    if (!anchor) return

    const href = anchor.getAttribute('href')?.trim()
    if (!href) return

    event.preventDefault()
    event.stopPropagation?.()

    if (isExternalHttpUrl(href)) {
      if (event.type === 'click' || event.type === 'auxclick') {
        openExternalLink(href)
      }
      return
    }

    if ((event.type !== 'click' && event.type !== 'auxclick') || !onShiftClickLink) return
    openLinkedObject(href, { forceNewTab: event.metaKey || event.ctrlKey })
  }, [onShiftClickLink, openExternalLink, openLinkedObject])

  const insertMentionLink = useCallback(
    async (option: MentionOption, activeEditor?: Editor | null) => {
      const targetEditor = activeEditor ?? editorRef.current
      if (!targetEditor) return

      const range =
        mentionRangeRef.current ??
        { from: targetEditor.state.selection.from, to: targetEditor.state.selection.from }
      const resolvedHref = await Promise.resolve(
        resolveMentionHref?.(option) ?? option.syncPath ?? option.syncPath ?? option.id,
      )
      const href = resolvedHref.trim()
      if (!href) return

      targetEditor
        .chain()
        .focus()
        .insertContentAt(range, {
          type: 'text',
          text: `@${option.title}`,
          marks: [{ type: 'link', attrs: { href } }],
        })
        .insertContent(' ')
        .run()
      closeMention()
    },
    [closeMention, resolveMentionHref],
  )

  const editor = useEditor({
    extensions,
    content: markdownToHtml(value),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'puzzlepkm-rich-editor-content ProseMirror',
      },
      handleDOMEvents: {
        click: (_view, event) => {
          const mouseEvent = event as MouseEvent
          const beforeDefaultPrevented = mouseEvent.defaultPrevented
          handleModifiedLinkClick(mouseEvent)
          return mouseEvent.defaultPrevented && !beforeDefaultPrevented
        },
      },
      handleKeyDown: (_view, event) => {
        if (mentionActive) {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setMentionSelectedIdx((i) => Math.min(i + 1, Math.max(mentionOptions.length - 1, 0)))
            return true
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setMentionSelectedIdx((i) => Math.max(i - 1, 0))
            return true
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            const option = mentionOptions[mentionSelectedIdx]
            event.preventDefault()
            if (!option) return true
            void insertMentionLink(option, editorRef.current)
            return true
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            closeMention()
            return true
          }
        }

        if (event.key === 'Enter') {
          const activeEditor = editorRef.current
          if (!activeEditor) return false
          event.preventDefault()

          // Enter inserts a soft line break by default; Shift+Enter forces a paragraph split.
          if (event.shiftKey) {
            return activeEditor.chain().focus().splitBlock().run()
          }

          if (activeEditor.chain().focus().setHardBreak().run()) {
            return true
          }
          return activeEditor.chain().focus().splitBlock().run()
        }
        return false
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      updateMentionState(nextEditor)
      if (isApplyingExternalValueRef.current) return
      commitMarkdownChange(htmlToMarkdown(nextEditor.getHTML()))
    },
    onSelectionUpdate: ({ editor: nextEditor }) => {
      updateMentionState(nextEditor)
    },
    onBlur: ({ editor: nextEditor }) => {
      updateMentionState(nextEditor)
    },
  })

  useEffect(() => {
    if (!mentionActive) {
      setMentionOptions([])
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const results = await searchObjects(mentionQuery, 8)
        if (!cancelled) {
          setMentionOptions(results)
          setMentionSelectedIdx(0)
        }
      } catch {
        if (!cancelled) setMentionOptions([])
      }
    }, 150)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [mentionActive, mentionQuery])

  useEffect(() => {
    editorRef.current = editor ?? null
  }, [editor])

  useEffect(() => {
    if (blocks) {
      const normalizedBlocks = blocks
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((block, index) => ({ ...block, position: index }))
      if (!areBlocksEqual(lastBlocksRef.current, normalizedBlocks)) {
        lastBlocksRef.current = normalizedBlocks
      }
      return
    }
    const derivedBlocks = reconcileBlocksWithMarkdown(lastBlocksRef.current, value)
    if (!areBlocksEqual(lastBlocksRef.current, derivedBlocks)) {
      lastBlocksRef.current = derivedBlocks
    }
  }, [blocks, value])

  useEffect(() => {
    if (!editor) return
    if (value === lastMarkdownRef.current) return

    isApplyingExternalValueRef.current = true
    editor.commands.setContent(markdownToHtml(value), { emitUpdate: false })
    lastMarkdownRef.current = value
    setMarkdownPreview(value)
    isApplyingExternalValueRef.current = false
    updateMentionState(editor)
  }, [editor, updateMentionState, value])

  useEffect(() => {
    const wasMarkdownView = previousMarkdownViewRef.current
    previousMarkdownViewRef.current = showMarkdownView

    if (!editor || showMarkdownView || !wasMarkdownView) return

    const nextMarkdown = markdownPreview.replace(/\r\n/g, '\n')
    isApplyingExternalValueRef.current = true
    editor.commands.setContent(markdownToHtml(nextMarkdown), { emitUpdate: false })
    lastMarkdownRef.current = nextMarkdown
    isApplyingExternalValueRef.current = false
    updateMentionState(editor)
  }, [editor, markdownPreview, showMarkdownView, updateMentionState])

  useEffect(() => {
    if (!showMarkdownView) return
    const frame = window.requestAnimationFrame(() => {
      markdownTextareaRef.current?.focus()
      markdownTextareaRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [showMarkdownView, isFullscreen])

  useEffect(() => {
    if (!isFullscreen || typeof document === 'undefined') return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isFullscreen])

  useEffect(() => {
    return () => editor?.destroy()
  }, [editor])

  useEffect(() => {
    if (!editor) return

    const root = editor.view.dom as HTMLElement
    const interceptAnchorEvent = (event: MouseEvent) => {
      const anchor = findAnchorTarget(event.target)
      const href = anchor?.getAttribute('href')?.trim()
      if (!anchor || !href) return

      event.preventDefault()
      event.stopPropagation()

      if (isExternalHttpUrl(href)) {
        if (event.type === 'click' || event.type === 'auxclick') {
          openExternalLink(href)
        }
        return
      }

      if ((event.type !== 'click' && event.type !== 'auxclick') || !onShiftClickLink) return
      openLinkedObject(href, { forceNewTab: event.metaKey || event.ctrlKey })
    }

    root.addEventListener('mousedown', interceptAnchorEvent, true)
    root.addEventListener('mouseup', interceptAnchorEvent, true)
    root.addEventListener('click', interceptAnchorEvent, true)
    root.addEventListener('auxclick', interceptAnchorEvent, true)

    return () => {
      root.removeEventListener('mousedown', interceptAnchorEvent, true)
      root.removeEventListener('mouseup', interceptAnchorEvent, true)
      root.removeEventListener('click', interceptAnchorEvent, true)
      root.removeEventListener('auxclick', interceptAnchorEvent, true)
    }
  }, [editor, onShiftClickLink, openExternalLink, openLinkedObject])

  const handleLinkPrompt = () => {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link URL', previousUrl ?? '')
    if (url === null) return
    if (!url.trim()) {
      editor.chain().focus().unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }

  const currentCount = maxLength && editor
    ? editor.storage.characterCount?.characters?.()
    : undefined


  const activeAdmonitionType = editor?.isActive('blockquote')
    ? String(editor.getAttributes('blockquote').admonitionType ?? '').trim().toLowerCase()
    : ''

  const handleApplyAdmonitionType = useCallback((type: AdmonitionType) => {
    if (!editor) return
    const chain = editor.chain().focus()
    const label = capitalize(type)
    if (editor.isActive('blockquote')) {
      chain.updateAttributes('blockquote', { admonitionType: type, admonitionLabel: label }).run()
    } else {
      chain.toggleBlockquote().updateAttributes('blockquote', { admonitionType: type, admonitionLabel: label }).run()
    }
  }, [editor])

  const shell = (
    <div className={cn(
      'relative flex h-full min-h-0 flex-1 flex-col overflow-hidden',
      isFullscreen ? 'fixed inset-0 z-50 h-screen w-screen bg-[var(--color-surface-app)] p-4' : '',
    )}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
          {label}
        </p>
        {typeof currentCount === 'number' && typeof maxLength === 'number' && (
          <p className={`text-sm ${currentCount > maxLength ? 'text-rose-300' : 'text-[var(--color-text-disabled)]'}`}>
            {currentCount}/{maxLength}
          </p>
        )}
      </div>

      <div className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]',
        isFullscreen && 'rounded-[18px]',
      )}>
        <TooltipProvider>
          <div className={cn(
            'flex shrink-0 flex-wrap gap-1 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] p-2',
            isFullscreen && 'p-3',
          )}>
            <ToolbarButton title="Heading" active={editor?.isActive('heading', { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
              <Heading2 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton title="Bold" active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()}>
              <Bold className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton title="Italic" active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()}>
              <Italic className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton title="Underline" active={editor?.isActive('underline')} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
              <UnderlineIcon className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton title="Strike" active={editor?.isActive('strike')} onClick={() => editor?.chain().focus().toggleStrike().run()}>
              <Strikethrough className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton title="Bullet list" active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
              <List className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton title="Ordered list" active={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
              <ListOrdered className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton title="Task list" active={editor?.isActive('taskList')} onClick={() => editor?.chain().focus().toggleTaskList().run()}>
              <ListChecks className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton title="Quote" active={editor?.isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
              <Quote className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton title="Code block" active={editor?.isActive('codeBlock')} onClick={() => editor?.chain().focus().toggleCodeBlock().run()}>
              <Code2 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton title="Horizontal rule" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>
              <Minus className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton title="Link" active={editor?.isActive('link')} onClick={handleLinkPrompt}>
              <Link2 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              title={showMarkdownView ? 'View Rich Text' : 'View Markdown'}
              active={showMarkdownView}
              onClick={() => setShowMarkdownView((current) => !current)}
            >
              <span className="text-xs font-bold leading-none tracking-[0.04em]">MD</span>
            </ToolbarButton>
            <ToolbarButton
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              active={isFullscreen}
              onClick={() => setIsFullscreen((current) => !current)}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </ToolbarButton>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      className={cn(
                        'flex h-[30px] w-[30px] items-center justify-center rounded-[10px] border text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-action-hover)] hover:text-[var(--color-text-primary)]',
                        activeAdmonitionType
                          ? 'border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] text-[var(--color-text-primary)]'
                          : 'border-transparent bg-transparent',
                      )}
                      aria-label="Admonition"
                    >
                      <Info className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{activeAdmonitionType ? `Admonition (${capitalize(activeAdmonitionType)})` : 'Admonition'}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent className="border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
                {ADMONITION_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onSelect={(event) => {
                      event.preventDefault()
                      handleApplyAdmonitionType(option.value)
                    }}
                    className={cn(
                      'min-h-[28px] px-2 text-xs',
                      activeAdmonitionType === option.value ? 'bg-[var(--color-selected-fill-soft)] text-[var(--color-text-primary)]' : undefined,
                    )}
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TooltipProvider>

        <div
          className={cn(
            'relative flex-1 overflow-auto bg-[var(--color-surface-elevated)] px-5 py-4',
            showMarkdownView && 'overflow-hidden p-0',
          )}
          onMouseDownCapture={(event) => {
            handleModifiedLinkClick(event)
          }}
          onClickCapture={(event) => {
            handleModifiedLinkClick(event)
          }}
        >
          {showMarkdownView ? (
            <Textarea
              ref={markdownTextareaRef}
              aria-label={`${label} markdown`}
              value={markdownPreview}
              onChange={(event) => {
                commitMarkdownChange(event.target.value)
              }}
              spellCheck={false}
              className="puzzlepkm-rich-editor-markdown h-full min-h-0 w-full resize-none rounded-none border-0 bg-transparent px-5 py-4 text-[var(--color-text-primary)] shadow-none outline-none placeholder:text-[var(--color-text-disabled)] focus-visible:ring-0"
            />
          ) : (
            <EditorContent editor={editor} />
          )}
        </div>
      </div>

      {mentionEnabled && !showMarkdownView && mentionActive && mentionPosition && (
        <MentionPopup
          query={mentionQuery}
          options={mentionOptions}
          selectedIndex={mentionSelectedIdx}
          onSelect={(option) => {
            void insertMentionLink(option)
          }}
          onClose={closeMention}
          position={mentionPosition}
        />
      )}
    </div>
  )

  return isFullscreen && typeof document !== 'undefined'
    ? createPortal(shell, document.body)
    : shell
}
