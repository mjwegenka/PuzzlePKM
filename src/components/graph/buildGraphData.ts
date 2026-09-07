import type { MetaBundle } from '@/lib/cliService'
import { getObjectDisplayTitle } from '@/lib/objectTypeDefinitions'

export type OpenableNodeType =
  | 'topic-note' | 'daily-note' | 'habit' | 'project' | 'ref-material' | 'scripture' | 'scripture-chapter'
export type GraphNodeType = OpenableNodeType | 'tag'

export interface GraphNode {
  id: string
  type: GraphNodeType
  label: string
  tags?: string[]
  /** Rendered node area — drives the visual weight of scripture hubs. */
  val: number
  /** Chapter nodes only: how many notes and distinct references roll up here. */
  noteCount?: number
  referenceCount?: number
  bookOrder?: number
}

export interface GraphEdge {
  source: string
  target: string
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphEdge[]
}

/** Chapter nodes scale with citations; everything else stays a uniform dot. */
export function chapterNodeValue(noteCount: number): number {
  return 1 + Math.sqrt(Math.max(noteCount, 0)) * 1.6
}

/**
 * DEC-75: Build the graph from a meta bundle.
 *
 * Scripture enters as chapters rather than verse-level references: a note's link
 * to "Mark 10:17-22" is redrawn as a link to the "Mark 10" chapter node, so every
 * note citing anywhere in Mark 10 converges on one hub instead of scattering
 * across nine separate dots. A reference spanning a chapter boundary contributes
 * an edge to each chapter it touches.
 */
export function buildGraphData(bundle: MetaBundle): GraphData {
  const nodes: GraphNode[] = [
    ...bundle.topicNotes.map((item) => ({
      id: item.id,
      type: 'topic-note' as const,
      label: getObjectDisplayTitle('topic-note', item),
      tags: item.tags ?? [],
      val: 1,
    })),
    ...bundle.dailyNotes.map((item) => ({
      id: item.id,
      type: 'daily-note' as const,
      label: getObjectDisplayTitle('daily-note', item),
      tags: item.tags ?? [],
      val: 1,
    })),
    ...bundle.habits.map((item) => ({
      id: item.id,
      type: 'habit' as const,
      label: getObjectDisplayTitle('habit', item),
      tags: item.tags ?? [],
      val: 1,
    })),
    ...bundle.files.map((item) => ({
      id: item.id,
      type: item.type,
      label: getObjectDisplayTitle(item.type, item),
      tags: item.tags ?? [],
      val: 1,
    })),
    ...bundle.scriptureChapters.map((item) => ({
      id: item.id,
      type: 'scripture-chapter' as const,
      label: item.reference,
      val: chapterNodeValue(item.noteCount),
      noteCount: item.noteCount,
      referenceCount: item.referenceCount,
      bookOrder: item.bookOrder,
    })),
    ...bundle.tags.map((item) => ({
      id: item.id,
      type: 'tag' as const,
      label: item.displayName,
      val: 1,
    })),
  ]

  const nodeIds = new Set(nodes.map((node) => node.id))
  const tagById = new Map(bundle.tags.map((t) => [t.name, t.id]))
  const edges = new Map<string, GraphEdge>()

  // Tag edges for every object type that carries tags.
  const taggedItems: Array<{ id: string; tags?: string[] }> = [
    ...bundle.topicNotes,
    ...bundle.dailyNotes,
    ...bundle.habits,
    ...bundle.files,
  ]
  for (const item of taggedItems) {
    for (const tag of item.tags ?? []) {
      const tagNodeId = tagById.get(tag)
      if (tagNodeId && nodeIds.has(tagNodeId)) {
        edges.set(`${item.id}->${tagNodeId}`, { source: item.id, target: tagNodeId })
      }
    }
  }

  const chapterIdsByScriptureId = new Map<string, string[]>()
  for (const link of bundle.scriptureChapterLinks) {
    const existing = chapterIdsByScriptureId.get(link.scriptureId)
    if (existing) existing.push(link.chapterId)
    else chapterIdsByScriptureId.set(link.scriptureId, [link.chapterId])
  }

  for (const link of bundle.objectLinks) {
    if (!nodeIds.has(link.sourceId)) continue

    const chapterIds = chapterIdsByScriptureId.get(link.targetId)
    if (chapterIds) {
      for (const chapterId of chapterIds) {
        if (!nodeIds.has(chapterId)) continue
        edges.set(`${link.sourceId}->${chapterId}`, { source: link.sourceId, target: chapterId })
      }
      continue
    }

    if (nodeIds.has(link.targetId)) {
      edges.set(`${link.sourceId}->${link.targetId}`, { source: link.sourceId, target: link.targetId })
    }
  }

  return { nodes, links: Array.from(edges.values()) }
}
