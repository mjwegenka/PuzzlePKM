import { Input, FilterChip, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from 'aslan-ui';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Maximize2, Network, Search, SlidersHorizontal } from 'lucide-react'

import { listMetaBundle } from '@/lib/cliService'
import { getObjectDisplayTitle } from '@/lib/objectTypeDefinitions'
import { getObjectColor } from '@/lib/objectColors'
import { itemMatchesTagFilters, type TagFilterState } from '@/lib/tagFilters'

// Lazy-load the 2D-only force graph wrapper (avoids THREE/AFRAME from 3D/VR/AR variants)
const ForceGraph2D = React.lazy(() =>
  import('./ForceGraph2DWrapper')
    .then(mod => ({ default: mod.default }))
    .catch((err) => {
      console.error('Failed to load ForceGraph2D:', err)
      return {
        default: () => (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-(--color-text-secondary)">
            <div>Force graph library not available</div>
            <div className="text-xs text-(--color-text-disabled) whitespace-pre-wrap wrap-break-word">
              {err instanceof Error ? err.message : String(err)}
            </div>
          </div>
        )
      }
    })
)

type GraphNodeType = 'topic-note' | 'daily-note' | 'habit' | 'project' | 'ref-material' | 'scripture' | 'tag' | 'scripture-book'

interface GraphNode {
  id: string
  type: GraphNodeType
  label: string
  tags?: string[]
  scriptureBook?: string
  isVirtual?: boolean
}

interface GraphEdge {
  source: string
  target: string
}

interface GraphData {
  nodes: GraphNode[]
  links: GraphEdge[]
}

interface ForceGraphHandle {
  zoomToFit: (durationMs?: number, padding?: number) => void
}

interface GraphPageProps {
  onOpenNode?: (target: { id: string; type: 'topic-note' | 'daily-note' | 'habit' | 'project' | 'ref-material' | 'scripture' }) => void | Promise<void>
  tagFilters?: TagFilterState
}

const GRAPH_OBJECT_TYPE_OPTIONS: Array<{ value: Exclude<GraphNodeType, 'scripture-book'>; label: string; checkedByDefault: boolean }> = [
  { value: 'topic-note', label: 'Topic Notes', checkedByDefault: true },
  { value: 'daily-note', label: 'Daily Notes', checkedByDefault: true },
  { value: 'habit', label: 'Habits', checkedByDefault: true },
  { value: 'project', label: 'Projects', checkedByDefault: true },
  { value: 'ref-material', label: 'Reference Materials', checkedByDefault: true },
  { value: 'scripture', label: 'Scriptures', checkedByDefault: true },
  { value: 'tag', label: 'Tags', checkedByDefault: false },
]
const DEFAULT_VISIBLE_GRAPH_TYPES = GRAPH_OBJECT_TYPE_OPTIONS
  .filter((option) => option.checkedByDefault)
  .map((option) => option.value)

export default function GraphPage({ onOpenNode, tagFilters = {} }: GraphPageProps) {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [visibleObjectTypes, setVisibleObjectTypes] = useState<Exclude<GraphNodeType, 'scripture-book'>[]>(DEFAULT_VISIBLE_GRAPH_TYPES)
  const [containerSize, setContainerSize] = useState({ width: 640, height: 480 })
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<ForceGraphHandle | null>(null)

  const handleResetView = useCallback(() => {
    graphRef.current?.zoomToFit(400, 40)
  }, [])

  const visibleObjectTypeSet = useMemo(() => new Set(visibleObjectTypes), [visibleObjectTypes])
  const isObjectTypeFilterCustomized = useMemo(
    () => GRAPH_OBJECT_TYPE_OPTIONS.some((option) => visibleObjectTypeSet.has(option.value) !== option.checkedByDefault),
    [visibleObjectTypeSet],
  )

  const toggleObjectTypeVisibility = (type: Exclude<GraphNodeType, 'scripture-book'>) => {
    setVisibleObjectTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return GRAPH_OBJECT_TYPE_OPTIONS.map((option) => option.value).filter((value) => next.has(value))
    })
  }

  // Extract book name from scripture reference (e.g., "Romans 3:16" -> "Romans")
  const extractScriptureBook = (reference: string): string => {
    const match = reference.match(/^([A-Za-z0-9\s]+?)\s+\d+/)
    return match?.[1]?.trim() || 'Other'
  }

  const loadGraph = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const bundle = await listMetaBundle()

      // Build primary nodes from all objects
      const allNodes: GraphNode[] = [
        ...bundle.topicNotes.map((item) => ({
          id: item.id,
          type: 'topic-note' as const,
          label: getObjectDisplayTitle('topic-note', item),
          tags: item.tags ?? [],
        })),
        ...bundle.dailyNotes.map((item) => ({
          id: item.id,
          type: 'daily-note' as const,
          label: getObjectDisplayTitle('daily-note', item),
          tags: item.tags ?? [],
        })),
        ...bundle.habits.map((item) => ({
          id: item.id,
          type: 'habit' as const,
          label: getObjectDisplayTitle('habit', item),
          tags: item.tags ?? [],
        })),
        ...bundle.files.map((item) => ({
          id: item.id,
          type: item.type,
          label: getObjectDisplayTitle(item.type, item),
          tags: item.tags ?? [],
        })),
        ...bundle.scriptures.map((item) => ({
          id: item.id,
          type: 'scripture' as const,
          label: getObjectDisplayTitle('scripture', item),
          scriptureBook: extractScriptureBook(item.reference),
        })),
        ...bundle.tags.map((item) => ({
          id: item.id,
          type: 'tag' as const,
          label: item.displayName,
        })),
      ]

      // Create virtual scripture-book grouping nodes
      const books = new Set(bundle.scriptures.map((s) => extractScriptureBook(s.reference)))
      const bookNodes: GraphNode[] = Array.from(books).map((book) => ({
        id: `book:${book}`,
        type: 'scripture-book' as const,
        label: book,
        isVirtual: true,
      }))
      allNodes.push(...bookNodes)

      const nodeIds = new Set(allNodes.map((node) => node.id))
      const tagById = new Map(bundle.tags.map((t) => [t.name, t.id]))
      const collectedEdges = new Map<string, GraphEdge>()

      // Scripture → book edges
      for (const scripture of bundle.scriptures) {
        const bookNodeId = `book:${extractScriptureBook(scripture.reference)}`
        collectedEdges.set(`${scripture.id}->${bookNodeId}`, { source: scripture.id, target: bookNodeId })
      }

      // Tag edges for ALL object types that carry tags
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
            collectedEdges.set(`${item.id}->${tagNodeId}`, { source: item.id, target: tagNodeId })
          }
        }
      }

      // Note-to-note and object link edges — from the bulk objectLinks query (no per-note fetches)
      for (const link of bundle.objectLinks) {
        if (nodeIds.has(link.sourceId) && nodeIds.has(link.targetId)) {
          collectedEdges.set(`${link.sourceId}->${link.targetId}`, { source: link.sourceId, target: link.targetId })
        }
      }

      setGraphData({ nodes: allNodes, links: Array.from(collectedEdges.values()) })
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadGraph()
  }, [loadGraph])

  useEffect(() => {
    const handler = () => void loadGraph();
    window.addEventListener('puzzlepkm:objects-updated', handler);
    return () => window.removeEventListener('puzzlepkm:objects-updated', handler);
  }, [loadGraph])

  const filteredData = useMemo(() => {
    const q = search.trim().toLowerCase()
    const nodeIds = new Set<string>()
    const visibleBookNodes = new Set<string>()

    // Gather visible primary nodes
    for (const node of graphData.nodes) {
      if (node.type === 'scripture-book') continue
      if (!visibleObjectTypeSet.has(node.type)) continue
      if (node.tags && !itemMatchesTagFilters(node.tags, tagFilters)) continue
      if (q && !node.label.toLowerCase().includes(q)) continue
      nodeIds.add(node.id)

      // Track which books have visible scriptures
      if (node.type === 'scripture' && node.scriptureBook) {
        visibleBookNodes.add(`book:${node.scriptureBook}`)
      }
    }

    // Include book nodes if they have visible scriptures
    const visibleNodes: GraphNode[] = graphData.nodes.filter((node) => {
      if (node.type === 'scripture-book') return visibleBookNodes.has(node.id)
      return nodeIds.has(node.id)
    })

    // Keep edges that connect visible nodes
    const visibleNodeSet = new Set(visibleNodes.map((n) => n.id))
    const visibleLinks: GraphEdge[] = graphData.links.filter(
      (link) => visibleNodeSet.has(String(link.source)) && visibleNodeSet.has(String(link.target)),
    )

    return { nodes: visibleNodes, links: visibleLinks }
  }, [graphData, search, tagFilters, visibleObjectTypeSet])

  const focusedNode = useMemo(
    () => graphData.nodes.find((node) => node.id === focusedNodeId) ?? null,
    [focusedNodeId, graphData.nodes],
  )

  const handleNodeClick = async (rawNode: unknown) => {
    // Defensive: ensure we have a valid node-like object with an id
    if (!rawNode || typeof rawNode !== 'object') {
      return
    }
    const node = rawNode as Partial<GraphNode>
    if (!node.id) {
      return
    }

    const nodeType = node.type as GraphNodeType
    if (nodeType === 'scripture-book' || nodeType === 'tag' || node.isVirtual) {
      return
    }
    if (focusedNodeId !== node.id) {
      setFocusedNodeId(node.id)
      return
    }
    if (onOpenNode) {
      await onOpenNode({ id: node.id, type: nodeType as 'topic-note' | 'daily-note' | 'habit' | 'project' | 'ref-material' | 'scripture' })
    }
  }

  const nodeCanvasSize = 5

  const getNodeLabel = (rawNode: unknown) => {
    if (!rawNode || typeof rawNode !== 'object') return ''
    const node = rawNode as Partial<GraphNode>
    if (!node.id || !node.type || !node.label) return ''
    if (node.type === 'scripture-book' || node.id === focusedNodeId) {
      return node.label
    }
    return ''
  }

  const getNodeColor = (rawNode: unknown) => {
    if (!rawNode || typeof rawNode !== 'object') return 'rgba(52, 50, 52, 0.95)'
    const node = rawNode as Partial<GraphNode>
    const nodeType = node.type ?? 'topic-note'
    const colors = getObjectColor(nodeType)
    if (node.id === focusedNodeId) return colors.accent
    return nodeType === 'scripture-book' ? colors.accent : 'rgba(52, 50, 52, 0.95)'
  }

  useEffect(() => {
    // Measure container size on mount and window resize
    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth || 640,
          height: containerRef.current.clientHeight || 480,
        })
      }
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  return (
    <div className="ui-shell-panel flex min-h-0 flex-1 flex-col bg-(--color-surface-elevated)">
      <div className="ui-toolbar-panel mb-3 flex min-h-17 shrink-0 flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-45 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-(--color-text-disabled)">
            <Network className="h-3.5 w-3.5" />
            Graph
          </div>
          <div className="mt-1 text-sm text-(--color-text-secondary)">
            {loading ? 'Loading graph' : `${filteredData.nodes.length} of ${graphData.nodes.filter((n) => n.type !== 'scripture-book').length} nodes`}
          </div>
        </div>
        <div className="ui-scroller flex min-w-0 flex-1 items-center gap-2 overflow-x-auto overflow-y-hidden py-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <FilterChip
                icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
                label="Object type"
                showCaret
                selected={isObjectTypeFilterCustomized}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {GRAPH_OBJECT_TYPE_OPTIONS.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.value}
                  checked={visibleObjectTypeSet.has(option.value)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() => toggleObjectTypeVisibility(option.value)}
                >
                  {option.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <FilterChip
            icon={<Maximize2 className="h-3.5 w-3.5" />}
            label="Reset view"
            onClick={handleResetView}
          />
        </div>
        <div className="relative w-62 max-w-full shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-text-disabled)" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search nodes"
            className="h-10 rounded-[10px] pl-10 pr-4 text-sm"
          />
        </div>
      </div>

      {error && (
        <div className="mb-1 rounded-md border border-destructive/35 bg-destructive/8 px-2 py-1 text-xs text-(--color-destructive)">
          {error}
        </div>
      )}

      <div className="relative mx-3 min-h-0 flex-1 overflow-hidden rounded-[18px] border" style={{ borderColor: 'var(--color-border-subtle)' }} ref={containerRef}>
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-(--color-text-secondary)" />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <div className="text-sm text-(--color-destructive)">Error loading graph</div>
            <div className="text-xs text-(--color-text-secondary)">{error}</div>
          </div>
        ) : filteredData.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-(--color-text-secondary)">
            <span>No nodes to display</span>
          </div>
        ) : (
          <React.Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-(--color-text-secondary)" />
              </div>
            }
           >
            {React.createElement(ForceGraph2D, {
              ref: graphRef,
              graphData: filteredData,
              width: containerSize.width,
              height: containerSize.height,
              onNodeClick: handleNodeClick,
              nodeLabel: getNodeLabel,
              nodeColor: getNodeColor,
              nodeRelSize: nodeCanvasSize,
              linkColor: () => 'rgba(221, 181, 80, 0.15)',
              linkWidth: 1,
              d3AlphaDecay: 0.0228,
              d3VelocityDecay: 0.26,
              warmupTicks: 20,
              cooldownTicks: 0,
              cooldownTime: 0,
              backgroundColor: 'rgba(26, 22, 18, 0.6)',
            })}
          </React.Suspense>
        )}
      </div>

      <div className="mx-3 mt-3 rounded-[14px] border border-(--color-border-subtle) bg-(--color-surface-sunken) px-3 py-2 text-sm text-(--color-text-secondary)">
        {focusedNode ? (
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: getObjectColor(focusedNode.type).accent }}
              />
              <span className="min-w-0 wrap-break-word font-semibold text-(--color-text-primary)">
                {focusedNode.label}
              </span>
            </div>
            <div className="text-xs uppercase tracking-[0.08em] text-(--color-text-disabled)">
              {focusedNode.type.replace('-', ' ')}
              {focusedNode.type !== 'scripture-book' && focusedNode.type !== 'tag' && focusedNode.tags && ` · ${focusedNode.tags.length} tags`}
            </div>
          </div>
        ) : (
          <span>Click a node to focus it and show details here. Double-click to open.</span>
        )}
      </div>

      <p className="px-4 py-2 text-sm text-(--color-text-disabled)">
        Tip: Drag to pan, scroll to zoom, click a node to focus it, double-click to open.
      </p>
    </div>
  )
}
