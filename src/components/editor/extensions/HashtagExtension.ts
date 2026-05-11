import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface HashtagExtensionOptions {
  onHashtagDetected: (tag: string) => void
}

/**
 * Detects #hashtag patterns as the user types and fires onHashtagDetected callback.
 * The hashtag is captured when the user types a word-boundary character (space, enter)
 * after a #word sequence.
 */
export const HashtagExtension = Extension.create<HashtagExtensionOptions>({
  name: 'hashtag',

  addOptions() {
    return {
      onHashtagDetected: () => {},
    }
  },

  addProseMirrorPlugins() {
    const { onHashtagDetected } = this.options

    return [
      new Plugin({
        key: new PluginKey('hashtag'),
        props: {
          handleTextInput(view, _from, _to, text) {
            // Only trigger on word-boundary characters
            if (!/\s/.test(text)) return false

            const { state } = view
            const { selection } = state
            const { $from } = selection

            // Look back through the current text node to find a #word
            const textBefore = $from.nodeBefore?.text ?? ''
            // Check textBefore for a completed hashtag (before the whitespace was typed)
            const hashtagMatch = textBefore.match(/#([a-zA-Z0-9_][a-zA-Z0-9_-]*)$/)
            if (hashtagMatch) {
              const tagName = hashtagMatch[1]
              // Fire callback asynchronously so it doesn't block the editor
              setTimeout(() => onHashtagDetected(tagName), 0)
            }

            return false
          },
        },
      }),
    ]
  },
})
