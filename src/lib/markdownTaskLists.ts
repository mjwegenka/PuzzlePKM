import type { MarkedExtension, Tokens } from 'marked'
import type TurndownService from 'turndown'

/**
 * Keeps Markdown task lists (`- [ ]` / `- [x]`) intact across the editor.
 *
 * Marked renders GFM task lists as `<ul><li><input type="checkbox">`, but
 * TipTap's TaskList/TaskItem only parse their own attribute-tagged shape
 * (`[data-type="taskList"]` / `[data-type="taskItem"]`) and have no parse rule
 * for a bare checkbox input. Left alone, the two halves disagreed in both
 * directions: a task in a note loaded as a plain bullet with its checkbox
 * dropped, and a task made with the toolbar button saved back as `-   text`.
 * Opening a note with tasks and saving it therefore destroyed them.
 */

/** TaskItem's content is `paragraph+`, so even a tight item needs a `<p>`. */
function renderTaskItemContent(
  parser: { parse: (tokens: Tokens.Generic[]) => string; parseInline: (tokens: Tokens.Generic[]) => string },
  token: Tokens.ListItem,
): string {
  const parts: string[] = []
  for (const child of token.tokens ?? []) {
    // The lexer gives `[x]` its own token; the checkbox is rendered from the
    // item's `checked` flag instead, so it must not also appear in the content.
    if (child.type === 'checkbox') continue
    if (child.type === 'text') {
      parts.push(`<p>${parser.parseInline((child as Tokens.Text).tokens ?? [])}</p>`)
    } else {
      parts.push(parser.parse([child]))
    }
  }
  return parts.join('') || '<p></p>'
}

function renderTaskItem(
  parser: { parse: (tokens: Tokens.Generic[]) => string; parseInline: (tokens: Tokens.Generic[]) => string },
  token: Tokens.ListItem,
): string {
  const checked = Boolean(token.checked)
  return `<li data-type="taskItem" data-checked="${checked}">`
    + `<label><input type="checkbox"${checked ? ' checked' : ''}><span></span></label>`
    + `<div>${renderTaskItemContent(parser, token)}</div>`
    + '</li>\n'
}

export const taskListMarkedExtension: MarkedExtension = {
  renderer: {
    // Only `list` is overridden. Overriding `listitem` as well would leak the
    // task shape into lists this declines to handle, because marked's default
    // `list` renderer calls back into whatever `listitem` is installed.
    list(token: Tokens.List) {
      // Only an all-task list becomes a taskList: TipTap cannot represent a
      // mixed one (taskList holds taskItem+, bulletList holds listItem+), so a
      // mixed list falls through to the default rendering untouched.
      if (token.items.length === 0 || !token.items.every((item) => item.task)) return false
      const items = token.items.map((item) => renderTaskItem(this.parser, item)).join('')
      return `<ul data-type="taskList">\n${items}</ul>\n`
    },
  },
}

/** The mirror of the renderer above, for saving the editor's HTML back out. */
export const taskListTurndownRule: TurndownService.Rule = {
  filter: (node) => node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem',
  replacement: (content, node) => {
    const raw = (node as HTMLElement).getAttribute('data-checked')
    // TipTap writes "true"/"false"; a bare `data-checked` also reads as checked.
    const checked = raw === 'true' || raw === ''
    const text = content.trim().replace(/\s*\n+\s*/g, ' ')
    return `- [${checked ? 'x' : ' '}] ${text}\n`
  },
}
