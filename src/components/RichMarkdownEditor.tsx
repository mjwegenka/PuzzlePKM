import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Box,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import FormatStrikethroughIcon from '@mui/icons-material/FormatStrikethrough'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered'
import FormatQuoteIcon from '@mui/icons-material/FormatQuote'
import CodeIcon from '@mui/icons-material/Code'
import ChecklistIcon from '@mui/icons-material/Checklist'
import TitleIcon from '@mui/icons-material/Title'
import LinkIcon from '@mui/icons-material/Link'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule'
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
import { searchObjects } from '../lib/cliService'
import type { NoteBlock } from '../shared/types'

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
  return marked.parse(transformAdmonitionMarkdownToHtml(markdown)) as string
}

function htmlToMarkdown(html: string): string {
  const normalizedHtml = normalizeEditorHtmlForMarkdown(html)
  const markdown = turndown.turndown(normalizedHtml)
    .replace(/\r\n/g, '\n')
  return markdown === '\n' ? '' : markdown
}

function fallbackBlockId(index: number): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(16)}${index.toString(16).padStart(2, '0')}`
  return `blk-${random.slice(0, 12).padEnd(12, '0')}`
}

function splitMarkdownIntoParagraphs(markdown: string): string[] {
  const raw = markdown.trimEnd()
  if (!raw) return []
  return raw.split(/\n{2,}/).map((paragraph) => paragraph.trimEnd()).filter(Boolean)
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
    <Tooltip title={title}>
      <IconButton
        size="small"
        onClick={onClick}
        sx={{
          color: active ? '#eceff3' : '#b8bec8',
          bgcolor: active ? 'rgba(79,143,237,0.24)' : 'transparent',
          border: active ? '1px solid #4f8fed' : '1px solid transparent',
          borderRadius: '6px',
          '&:hover': {
            bgcolor: 'rgba(79,143,237,0.16)',
          },
        }}
      >
        {children}
      </IconButton>
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
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionOptions, setMentionOptions] = useState<MentionOption[]>([])
  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0)
  const [mentionPosition, setMentionPosition] = useState<{ top: number; left: number } | null>(null)
  const [admonitionMenuAnchor, setAdmonitionMenuAnchor] = useState<HTMLElement | null>(null)

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

    const hasOpenModifier = event.shiftKey || event.metaKey || event.ctrlKey
    if (!hasOpenModifier || !onShiftClickLink) return
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
        resolveMentionHref?.(option) ?? option.syncPath ?? option.dropboxPath ?? option.id,
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
        class: 'dropith-rich-editor-content ProseMirror',
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
        if (!mentionActive) return false

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
        if (event.key === 'Enter') {
          const option = mentionOptions[mentionSelectedIdx]
          if (!option) return false
          event.preventDefault()
          void insertMentionLink(option, editor)
          return true
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          closeMention()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      updateMentionState(nextEditor)
      if (isApplyingExternalValueRef.current) return
      const nextMarkdown = htmlToMarkdown(nextEditor.getHTML())
      if (nextMarkdown !== lastMarkdownRef.current) {
        lastMarkdownRef.current = nextMarkdown
        const nextBlocks = reconcileBlocksWithMarkdown(lastBlocksRef.current, nextMarkdown)
        if (!areBlocksEqual(nextBlocks, lastBlocksRef.current)) {
          lastBlocksRef.current = nextBlocks
          onBlocksChange?.(nextBlocks)
        }
        onChange(nextMarkdown)
      }
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
    isApplyingExternalValueRef.current = false
    updateMentionState(editor)
  }, [editor, updateMentionState, value])

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

      const hasOpenModifier = event.shiftKey || event.metaKey || event.ctrlKey
      if (!hasOpenModifier || !onShiftClickLink) return
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
    setAdmonitionMenuAnchor(null)
  }, [editor])

  const handleAdmonitionMenuOpen = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setAdmonitionMenuAnchor(event.currentTarget)
  }, [])

  const handleAdmonitionMenuClose = useCallback(() => {
    setAdmonitionMenuAnchor(null)
  }, [])

  return (
    <Box sx={{ flex: 1, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.75 }}>
        <Typography variant="caption" sx={{ color: '#b8bec8', fontSize: '12px', fontWeight: 500 }}>
          {label}
        </Typography>
        {typeof currentCount === 'number' && typeof maxLength === 'number' && (
          <Typography variant="caption" sx={{ color: currentCount > maxLength ? '#ef5350' : '#9198a3', fontSize: '11px' }}>
            {currentCount}/{maxLength}
          </Typography>
        )}
      </Stack>

      <Box
        sx={{
          border: '1px solid rgba(184,190,200,0.45)',
          borderRadius: '12px',
          bgcolor: 'rgba(11, 24, 40, 0.75)',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ p: 1, borderBottom: '1px solid rgba(255,255,255,0.09)', flexShrink: 0 }}>
          <ToolbarButton title="Heading" active={editor?.isActive('heading', { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
            <TitleIcon fontSize="small" />
          </ToolbarButton>
          <ToolbarButton title="Bold" active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()}>
            <FormatBoldIcon fontSize="small" />
          </ToolbarButton>
          <ToolbarButton title="Italic" active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()}>
            <FormatItalicIcon fontSize="small" />
          </ToolbarButton>
          <ToolbarButton title="Underline" active={editor?.isActive('underline')} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
            <Typography sx={{ fontSize: '15px', textDecoration: 'underline', lineHeight: 1 }}>U</Typography>
          </ToolbarButton>
          <ToolbarButton title="Strike" active={editor?.isActive('strike')} onClick={() => editor?.chain().focus().toggleStrike().run()}>
            <FormatStrikethroughIcon fontSize="small" />
          </ToolbarButton>
          <ToolbarButton title="Bullet list" active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
            <FormatListBulletedIcon fontSize="small" />
          </ToolbarButton>
          <ToolbarButton title="Ordered list" active={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
            <FormatListNumberedIcon fontSize="small" />
          </ToolbarButton>
          <ToolbarButton title="Task list" active={editor?.isActive('taskList')} onClick={() => editor?.chain().focus().toggleTaskList().run()}>
            <ChecklistIcon fontSize="small" />
          </ToolbarButton>
          <ToolbarButton title="Quote" active={editor?.isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
            <FormatQuoteIcon fontSize="small" />
          </ToolbarButton>
          <ToolbarButton title="Code block" active={editor?.isActive('codeBlock')} onClick={() => editor?.chain().focus().toggleCodeBlock().run()}>
            <CodeIcon fontSize="small" />
          </ToolbarButton>
          <ToolbarButton title="Horizontal rule" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>
            <HorizontalRuleIcon fontSize="small" />
          </ToolbarButton>
          <ToolbarButton title="Link" active={editor?.isActive('link')} onClick={handleLinkPrompt}>
            <LinkIcon fontSize="small" />
          </ToolbarButton>
          <Button
            size="small"
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleAdmonitionMenuOpen}
            endIcon={<ArrowDropDownIcon fontSize="small" />}
            sx={{
              minHeight: 30,
              px: 1,
              borderRadius: '6px',
              border: '1px solid',
              borderColor: activeAdmonitionType ? '#4f8fed' : 'rgba(255,255,255,0.09)',
              bgcolor: activeAdmonitionType ? 'rgba(79,143,237,0.24)' : 'transparent',
              color: activeAdmonitionType ? '#eceff3' : '#b8bec8',
              textTransform: 'none',
              '&:hover': {
                bgcolor: 'rgba(79,143,237,0.16)',
                borderColor: '#4f8fed',
              },
            }}
          >
            {activeAdmonitionType ? `Admonition: ${capitalize(activeAdmonitionType)}` : 'Admonition'}
          </Button>
        </Stack>

        <Menu
          anchorEl={admonitionMenuAnchor}
          open={Boolean(admonitionMenuAnchor)}
          onClose={handleAdmonitionMenuClose}
          slotProps={{
            paper: {
              sx: {
                bgcolor: '#1a1c1f',
                border: '1px solid rgba(255,255,255,0.09)',
              },
            },
          }}
        >
          {ADMONITION_OPTIONS.map((option) => (
            <MenuItem
              key={option.value}
              selected={activeAdmonitionType === option.value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleApplyAdmonitionType(option.value)}
            >
              {option.label}
            </MenuItem>
          ))}
        </Menu>

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            position: 'relative',
            pl: 1.5,
            pr: 1.5,
            py: 1.25,
          }}
          onMouseDownCapture={(event) => {
            handleModifiedLinkClick(event)
          }}
          onClickCapture={(event) => {
            handleModifiedLinkClick(event)
          }}
        >
          <EditorContent editor={editor} />
        </Box>
      </Box>

      {mentionEnabled && mentionActive && mentionPosition && (
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
    </Box>
  )
}
