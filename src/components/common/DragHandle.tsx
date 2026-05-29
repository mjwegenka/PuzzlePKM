import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'

interface HandleState {
  /** Absolute Y from top of the scroll-container's content, accounting for scroll */
  top: number
  /** ProseMirror position of the block's opening token */
  nodePos: number
  /** Block height — used to vertically centre the icon */
  height: number
}

interface DragHandleProps {
  editor: Editor
}

/**
 * Notion-style ⠿ drag handle.
 *
 * Renders `position: absolute` inside the editor's scroll container so it
 * lives in the left gutter (the extra padding RichMarkdownEditor adds when
 * dragHandleEnabled is true). Being inside the container means:
 *   - It is never clipped by outer overflow: hidden wrappers.
 *   - It scrolls naturally with the content.
 *   - z-index only needs to beat sibling content, not outer overlay layers.
 *
 * Mouse tracking is on the *scroll container* (the parent of the ProseMirror
 * div), not just on the ProseMirror div itself.  When the pointer moves into
 * the left-padding gutter area, we clamp X to just
 * inside the ProseMirror div so posAtCoords resolves a real position.
 */
export function DragHandle({ editor }: DragHandleProps) {
  const [handleState, setHandleState] = useState<HandleState | null>(null)
  const isDraggingRef = useRef(false)
  const isPointerOverHandleRef = useRef(false)
  const rafRef = useRef<number>(0)

  // ── Position computation ───────────────────────────────────────────────────

  const computeHandle = useCallback(
    (clientX: number, clientY: number) => {
      const { view } = editor
      if (!view.editable) return

      const editorDom = view.dom as HTMLElement
      const scrollContainer = editorDom.parentElement
      if (!scrollContainer) return

      const containerRect = scrollContainer.getBoundingClientRect()
      const editorRect = editorDom.getBoundingClientRect()
      const isWithinContainer =
        clientX >= containerRect.left &&
        clientX <= containerRect.right &&
        clientY >= containerRect.top &&
        clientY <= containerRect.bottom

      if (!isWithinContainer) {
        setHandleState(null)
        return
      }

      const isInLeftGutter = clientX < editorRect.left + 8
      const clampedX = Math.max(clientX, editorRect.left + 4)
      const pos = view.posAtCoords({ left: clampedX, top: clientY })

      // While pointer is in gutter or directly over the handle, keep the last
      // resolved block instead of flickering away when posAtCoords returns null.
      if (!pos) {
        if (isInLeftGutter || isPointerOverHandleRef.current) return
        setHandleState(null)
        return
      }

      const { doc } = editor.state
      const $pos = doc.resolve(pos.pos)
      if ($pos.depth === 0) {
        if (isInLeftGutter || isPointerOverHandleRef.current) return
        setHandleState(null)
        return
      }

      const nodePos = $pos.before(1)
      const domNode = view.nodeDOM(nodePos)
      if (!(domNode instanceof HTMLElement)) {
        setHandleState(null)
        return
      }

      const blockRect = domNode.getBoundingClientRect()
      const top = blockRect.top - containerRect.top + scrollContainer.scrollTop
      setHandleState({ top, nodePos, height: blockRect.height })
    },
    [editor],
  )

  // ── Listeners ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const editorDom = editor.view.dom as HTMLElement
    // Track over the whole scroll container (including the left-padding gutter).
    const scrollContainer = editorDom.parentElement
    if (!scrollContainer) return

    const onMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) return
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() =>
        computeHandle(e.clientX, e.clientY),
      )
    }

    const onMouseLeave = () => {
      if (isDraggingRef.current || isPointerOverHandleRef.current) return
      setHandleState(null)
    }

    const onScroll = () => {
      if (!isDraggingRef.current) setHandleState(null)
    }

    scrollContainer.addEventListener('mousemove', onMouseMove)
    scrollContainer.addEventListener('mouseleave', onMouseLeave)
    scrollContainer.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      cancelAnimationFrame(rafRef.current)
      scrollContainer.removeEventListener('mousemove', onMouseMove)
      scrollContainer.removeEventListener('mouseleave', onMouseLeave)
      scrollContainer.removeEventListener('scroll', onScroll)
    }
  }, [editor, computeHandle])

  // ── Drag handlers ──────────────────────────────────────────────────────────

  const onMouseDown = useCallback(
    () => {
      // Do NOT preventDefault — it blocks HTML5 drag initiation.
      // Plain divs don't steal keyboard focus so this is safe.
      if (!handleState) return
      const { view } = editor
      try {
        view.dispatch(
          view.state.tr.setSelection(
            NodeSelection.create(view.state.doc, handleState.nodePos),
          ),
        )
      } catch {
        // Some nodes reject NodeSelection; fail silently.
      }
    },
    [editor, handleState],
  )

  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      if (!handleState) {
        e.preventDefault()
        return
      }

      const { view } = editor

      // mousedown above should have set NodeSelection already; guard races.
      let sel = view.state.selection
      if (!(sel instanceof NodeSelection)) {
        try {
          view.dispatch(
            view.state.tr.setSelection(
              NodeSelection.create(view.state.doc, handleState.nodePos),
            ),
          )
          sel = view.state.selection
        } catch {
          e.preventDefault()
          return
        }
      }

      if (!(sel instanceof NodeSelection)) {
        e.preventDefault()
        return
      }

      const slice = sel.content()
      const { dom, text } = view.serializeForClipboard(slice)

      e.dataTransfer.clearData()
      e.dataTransfer.setData('text/html', dom.innerHTML)
      e.dataTransfer.setData('text/plain', text)
      e.dataTransfer.effectAllowed = 'move'

      // Use the block DOM as the drag image.
      const blockDom = view.nodeDOM(sel.from)
      if (blockDom instanceof HTMLElement) {
        e.dataTransfer.setDragImage(blockDom, 0, 8)
      }

      // Give ProseMirror the slice so its drop handler can process the drop.
      view.dragging = { slice, move: true }
      isDraggingRef.current = true
    },
    [editor, handleState],
  )

  const onDragEnd = useCallback(() => {
    isDraggingRef.current = false
    isPointerOverHandleRef.current = false
    setHandleState(null)
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!handleState) return null

  // Align with the first text line near the block top (Notion-style), rather
  // than centering in the full block height.
  const iconTopOffset = 2

  return (
    <div
      draggable
      onMouseEnter={() => {
        isPointerOverHandleRef.current = true
      }}
      onMouseLeave={() => {
        isPointerOverHandleRef.current = false
      }}
      onMouseDown={onMouseDown}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="absolute z-[5] flex select-none items-center justify-center rounded-[4px] text-lg leading-none text-[rgba(125,186,214,0.35)] transition-[color,background-color] duration-120 hover:bg-[rgba(125,186,214,0.10)] hover:text-[rgba(125,186,214,0.9)] active:cursor-grabbing"
      style={{
        top: handleState.top + iconTopOffset,
        left: 6,
        width: 20,
        height: 24,
        cursor: 'grab',
      }}
      title="Drag to reorder"
      aria-label="Drag to reorder block"
    >
      ⠿
    </div>
  )
}

