import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { SearchResult } from '../../shared/types'

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface MentionListProps {
  items: SearchResult[]
  command: (item: { id: string; label: string }) => void
}

const MentionListComponent = forwardRef<MentionListRef, MentionListProps>((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectItem = (index: number) => {
    const item = props.items[index]
    if (item) {
      props.command({ id: item.id, label: item.title })
    }
  }

  useEffect(() => setSelectedIndex(0), [props.items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((i) => (i + props.items.length - 1) % props.items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((i) => (i + 1) % props.items.length)
        return true
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex)
        return true
      }
      return false
    },
  }))

  if (!props.items.length) return null

  return (
    <div
      ref={containerRef}
      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 max-h-60 overflow-y-auto min-w-48 z-50"
    >
      {props.items.map((item, index) => (
        <button
          key={item.id}
          className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
            index === selectedIndex
              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
          onClick={() => selectItem(index)}
        >
          <span className="text-xs text-gray-400 capitalize">{item.type}</span>
          <span className="flex-1 truncate">{item.title}</span>
        </button>
      ))}
    </div>
  )
})

MentionListComponent.displayName = 'MentionList'

export default function MentionList() {
  let component: MentionListRef | null = null
  let element: HTMLElement | null = null
  // A single root is stored so we can call render/unmount on the same root instance.
  let reactRoot: import('react-dom/client').Root | null = null

  return {
    onBeforeStart: (props: unknown) => {
      void props
    },
    onStart: (props: { editor: unknown; clientRect?: (() => DOMRect | null) | null; items: SearchResult[]; command: (item: { id: string; label: string }) => void }) => {
      element = document.createElement('div')
      document.body.appendChild(element)

      import('react-dom/client').then(({ createRoot }) => {
        reactRoot = createRoot(element!)
        reactRoot.render(
          <MentionListComponent
            ref={(ref) => { component = ref }}
            items={props.items}
            command={props.command}
          />
        )
      })
    },
    onUpdate: (props: { items: SearchResult[]; command: (item: { id: string; label: string }) => void }) => {
      if (!reactRoot) return
      reactRoot.render(
        <MentionListComponent
          ref={(ref) => { component = ref }}
          items={props.items}
          command={props.command}
        />
      )
    },
    onKeyDown: (props: { event: KeyboardEvent }) => {
      if (!component) return false
      return component.onKeyDown(props)
    },
    onExit: () => {
      if (reactRoot) {
        reactRoot.unmount()
        reactRoot = null
      }
      element?.remove()
      element = null
    },
  }
}
