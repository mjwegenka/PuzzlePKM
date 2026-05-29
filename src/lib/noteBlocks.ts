import type { NoteBlock } from '../shared/types';

// DEC-34: Block identity & linking format.
// All note-block utilities are centralised here so that UI surfaces (editor,
// object editor) and the CLI service layer share one implementation instead of
// each maintaining their own copies.

/** Generate a stable fallback block ID when no persisted ID is available. */
export function fallbackBlockId(index: number): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(16)}${index.toString(16).padStart(2, '0')}`;
  return `blk-${random.slice(0, 12).padEnd(12, '0')}`;
}

/**
 * Parse legacy note content (single contentMarkdown string) into a block list.
 * Splits on paragraph boundaries and extracts embedded block IDs from trailing
 * HTML comments of the form `<!-- blk-xxxxxxxxxxxx -->`.
 */
export function parseLegacyBlocksFromMarkdown(contentMarkdown: string): NoteBlock[] {
  const raw = String(contentMarkdown ?? '')
    .replace(/\r\n/g, '\n')
    .trimEnd();
  if (!raw) return [];
  const paragraphs = raw.split('\n\n').map((p) => p.trimEnd());
  return paragraphs.map((paragraph, index) => {
    const match = /\s*<!--\s*(blk-[a-f0-9]{12})\s*-->\s*$/.exec(paragraph);
    return {
      blockId: match?.[1] ?? fallbackBlockId(index),
      position: index,
      contentMarkdown: match ? paragraph.slice(0, match.index).trimEnd() : paragraph,
    };
  });
}

/**
 * Normalise a raw blocks payload (from JSON/persistence) into an ordered
 * `NoteBlock[]`.  Falls back to `parseLegacyBlocksFromMarkdown` when the
 * payload is missing or empty.
 */
export function normalizeNoteBlocks(
  rawBlocks: unknown,
  contentMarkdown: string,
): NoteBlock[] {
  if (Array.isArray(rawBlocks)) {
    const parsed = rawBlocks
      .map((rawBlock, index) => {
        if (!rawBlock || typeof rawBlock !== 'object') return null;
        const block = rawBlock as Record<string, unknown>;
        const blockId =
          typeof block.blockId === 'string' && block.blockId
            ? block.blockId
            : fallbackBlockId(index);
        const position =
          typeof block.position === 'number' ? block.position : index;
        const blockContent =
          typeof block.contentMarkdown === 'string' ? block.contentMarkdown : '';
        return { blockId, position, contentMarkdown: blockContent };
      })
      .filter((block): block is NoteBlock => Boolean(block))
      .sort((a, b) => a.position - b.position)
      .map((block, index) => ({ ...block, position: index }));
    if (parsed.length > 0) return parsed;
  }
  return parseLegacyBlocksFromMarkdown(contentMarkdown);
}

/** Join an ordered block list back into a single markdown string. */
export function joinBlockMarkdown(blocks: NoteBlock[]): string {
  if (blocks.length === 0) return '';
  return blocks
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((block) => block.contentMarkdown)
    .join('\n\n');
}
