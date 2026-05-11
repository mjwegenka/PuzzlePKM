import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import Mention from '@tiptap/extension-mention'
import { useCallback, useEffect } from 'react'
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Code, Link2,
} from 'lucide-react'
import MentionList from './MentionList'
import { BacklinkExtension } from './extensions/BacklinkExtension'
import { HashtagExtension } from './extensions/HashtagExtension'
import { Button } from '../ui/button'

export interface NoteEditorProps {
  content: object
  onChange: (content: object, markdown: string) => void
  onTagDetected?: (tagName: string) => void
  placeholder?: string
  editable?: boolean
}

function jsonToMarkdown(json: object): string {
  const doc = json as { type: string; content?: unknown[] }
  if (!doc.content) return ''
  return nodeToMarkdown(doc)
}

function nodeToMarkdown(node: { type: string; content?: unknown[]; text?: string; marks?: Array<{ type: string }>; attrs?: Record<string, unknown> }): string {
  if (node.type === 'text') {
    let text = node.text ?? ''
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === 'bold') text = `**${text}**`
        else if (mark.type === 'italic') text = `*${text}*`
        else if (mark.type === 'underline') text = `__${text}__`
        else if (mark.type === 'strike') text = `~~${text}~~`
        else if (mark.type === 'code') text = `\`${text}\``
      }
    }
    return text
  }

  const children = (node.content ?? []) as typeof node[]
  const childText = children.map(nodeToMarkdown).join('')

  switch (node.type) {
    case 'doc': return childText
    case 'paragraph': return childText + '\n\n'
    case 'heading': {
      const level = (node.attrs?.level as number) ?? 1
      return '#'.repeat(level) + ' ' + childText + '\n\n'
    }
    case 'bulletList': return childText
    case 'orderedList': return childText
    case 'listItem': return '- ' + childText
    case 'blockquote': return '> ' + childText
    case 'codeBlock': return '```\n' + childText + '\n```\n\n'
    case 'hardBreak': return '\n'
    case 'horizontalRule': return '---\n\n'
    default: return childText
  }
}

export default function NoteEditor({ content, onChange, onTagDetected, placeholder = 'Start writing…', editable = true }: NoteEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
      CharacterCount,
      BacklinkExtension,
      HashtagExtension.configure({
        onHashtagDetected: (tagName) => {
          onTagDetected?.(tagName)
        },
      }),
      Mention.configure({
        HTMLAttributes: { class: 'mention' },
        suggestion: {
          items: async ({ query }: { query: string }) => {
            if (!query) return []
            try {
              const result = await window.dropith.search(query)
              return result.data ?? []
            } catch (err) {
              console.error('[Mention] Search failed:', err)
              return []
            }
          },
          render: () => MentionList(),
        },
      }),
    ],
    content: Object.keys(content).length === 0 ? '' : content,
    editable,
    onUpdate: ({ editor }) => {
      const json = editor.getJSON()
      const markdown = jsonToMarkdown(json)
      onChange(json, markdown)
    },
  })

  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.setEditable(editable)
    }
  }, [editor, editable])

  const setLink = useCallback(() => {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href as string
    const url = window.prompt('URL', previousUrl)
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  if (!editor) return null

  const charCount = editor.storage.characterCount?.characters() ?? 0

  return (
    <div className="flex flex-col h-full">
      {editable && (
        <div className="flex items-center gap-0.5 px-3 py-2 border-b border-[#262626] flex-wrap bg-[#191919]">
          <ToolbarButton
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Bold (⌘B)"
          ><Bold size={14} /></ToolbarButton>
          <ToolbarButton
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Italic (⌘I)"
          ><Italic size={14} /></ToolbarButton>
          <ToolbarButton
            active={editor.isActive('underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            title="Underline (⌘U)"
          ><UnderlineIcon size={14} /></ToolbarButton>
          <ToolbarButton
            active={editor.isActive('strike')}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            title="Strikethrough"
          ><Strikethrough size={14} /></ToolbarButton>
          <div className="w-px h-5 bg-[#2f2f2f] mx-1" />
          <ToolbarButton
            active={editor.isActive('heading', { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            title="Heading 1"
          ><Heading1 size={14} /></ToolbarButton>
          <ToolbarButton
            active={editor.isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            title="Heading 2"
          ><Heading2 size={14} /></ToolbarButton>
          <ToolbarButton
            active={editor.isActive('heading', { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            title="Heading 3"
          ><Heading3 size={14} /></ToolbarButton>
          <div className="w-px h-5 bg-[#2f2f2f] mx-1" />
          <ToolbarButton
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title="Bullet List"
          ><List size={14} /></ToolbarButton>
          <ToolbarButton
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title="Numbered List"
          ><ListOrdered size={14} /></ToolbarButton>
          <div className="w-px h-5 bg-[#2f2f2f] mx-1" />
          <ToolbarButton
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            title="Blockquote"
          ><Quote size={14} /></ToolbarButton>
          <ToolbarButton
            active={editor.isActive('code')}
            onClick={() => editor.chain().focus().toggleCode().run()}
            title="Inline Code"
          ><Code size={14} /></ToolbarButton>
          <ToolbarButton
            active={editor.isActive('link')}
            onClick={setLink}
            title="Link"
          ><Link2 size={14} /></ToolbarButton>
        </div>
      )}

      {editor && editable && (
        <BubbleMenu editor={editor}>
          <div className="flex items-center gap-0.5 bg-[#222222] border border-[#333333] rounded-lg shadow-xl px-1.5 py-1">
            <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><Bold size={13} /></ToolbarButton>
            <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><Italic size={13} /></ToolbarButton>
            <ToolbarButton active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"><UnderlineIcon size={13} /></ToolbarButton>
            <ToolbarButton active={editor.isActive('link')} onClick={setLink} title="Link"><Link2 size={13} /></ToolbarButton>
          </div>
        </BubbleMenu>
      )}

      <EditorContent
        editor={editor}
        className="flex-1 overflow-y-auto px-10 py-5 prose prose-sm dark:prose-invert max-w-none focus:outline-none"
      />

      <div className="flex items-center justify-end px-4 py-1 border-t border-[#262626] text-xs text-[#5a5a5a]">
        {charCount} characters
      </div>
    </div>
  )
}

interface ToolbarButtonProps {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}

function ToolbarButton({ active, onClick, title, children }: ToolbarButtonProps) {
  return (
    <Button
      onClick={onClick}
      title={title}
      size="icon"
      variant={active ? 'active' : 'ghost'}
      className="h-7 w-7"
    >
      {children}
    </Button>
  )
}
