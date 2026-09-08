import { Input, FilterChip, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from 'aslan-ui';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Maximize2, Network, Orbit, Search, SlidersHorizontal } from 'lucide-react'

import { listMetaBundle } from '@/lib/cliService'
import {
  SCRIPTURE_SECTIONS,
  getObjectColor,
  getScriptureSection,
  getScriptureSectionColor,
  getScriptureSectionLabel,
  getSectionColor,
} from '@/lib/objectColors'
import { itemMatchesTagFilters, type TagFilterState } from '@/lib/tagFilters'
import {
  buildGraphData,
  type GraphData,
  type GraphEdge,
  type GraphNode,
  type GraphNodeType,
  type OpenableNodeType,
} from './buildGraphData'

interface ForceGraphHandle {
  zoomToFit: (durationMs?: number, padding?: number) => void
}

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

interface GraphPageProps {
  onOpenNode?: (target: { id: string; type: OpenableNodeType }) => void | Promise<void>
  tagFilters?: TagFilterState
}

// DEC-75: scripture enters the graph as chapters, not verse-level references —
// one node per chapter is the unit that actually clusters. Notes and chapters are
// on by default because they are the only edges that carry real signal; the rest
// are opt-in so the default view is the scripture network rather than 1,800 nodes.
const GRAPH_OBJECT_TYPE_OPTIONS: Array<{ value: GraphNodeType; label: string; checkedByDefault: boolean }> = [
  { value: 'scripture-chapter', label: 'Scripture Chapters', checkedByDefault: true },
  { value: 'topic-note', label: 'Topic Notes', checkedByDefault: true },
  { value: 'daily-note', label: 'Daily Notes', checkedByDefault: true },
  { value: 'habit', label: 'Habits', checkedByDefault: false },
  { value: 'project', label: 'Projects', checkedByDefault: false },
  { value: 'ref-material', label: 'Reference Materials', checkedByDefault: false },
  { value: 'tag', label: 'Tags', checkedByDefault: false },
]
const DEFAULT_VISIBLE_GRAPH_TYPES = GRAPH_OBJECT_TYPE_OPTIONS
  .filter((option) => option.checkedByDefault)
  .map((option) => option.value)

// DEC-77: chapters open into the chapter view, so they are openable too — only
// tags still have no destination of their own.
const OPENABLE_NODE_TYPES = new Set<string>([
  'topic-note', 'daily-note', 'habit', 'project', 'ref-material', 'scripture', 'scripture-chapter',
])

/**
 * force-graph replaces a link's `source`/`target` string ids with live node
 * objects once the simulation runs, so any code reading them back has to accept
 * either shape. Filtered links are handed to the graph as fresh objects
 * (see `filteredData`) to keep `graphData` itself free of those mutations.
 */
function endpointId(value: unknown): string {
  if (value && typeof value === 'object') return String((value as { id?: unknown }).id ?? '')
  return String(value ?? '')
}

export default function GraphPage({ onOpenNode, tagFilters = {} }: GraphPageProps) {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [visibleObjectTypes, setVisibleObjectTypes] = useState<GraphNodeType[]>(DEFAULT_VISIBLE_GRAPH_TYPES)
  const [showIsolated, setShowIsolated] = useState(false)
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

  const toggleObjectTypeVisibility = (type: GraphNodeType) => {
    setVisibleObjectTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return GRAPH_OBJECT_TYPE_OPTIONS.map((option) => option.value).filter((value) => next.has(value))
    })
  }

  const loadGraph = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const bundle = await listMetaBundle()
      setGraphData(buildGraphData(bundle))
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

    const allowed: GraphNode[] = []
    for (const node of graphData.nodes) {
      if (!visibleObjectTypeSet.has(node.type)) continue
      if (node.tags && !itemMatchesTagFilters(node.tags, tagFilters)) continue
      allowed.push(node)
    }
    const allowedIds = new Set(allowed.map((node) => node.id))

    let visibleIds: Set<string>
    if (q) {
      // Searching a chapter should show its neighborhood, not a lone dot — the
      // matches plus everything directly connected to them.
      const matched = new Set(
        allowed.filter((node) => node.label.toLowerCase().includes(q)).map((node) => node.id),
      )
      visibleIds = new Set(matched)
      for (const link of graphData.links) {
        const source = endpointId(link.source)
        const target = endpointId(link.target)
        if (matched.has(source) && allowedIds.has(target)) visibleIds.add(target)
        if (matched.has(target) && allowedIds.has(source)) visibleIds.add(source)
      }
    } else {
      visibleIds = allowedIds
    }

    // Fresh link objects: force-graph mutates whatever it is given, and
    // `graphData` has to stay a clean source of truth across re-filters.
    const visibleLinks: GraphEdge[] = []
    for (const link of graphData.links) {
      const source = endpointId(link.source)
      const target = endpointId(link.target)
      if (visibleIds.has(source) && visibleIds.has(target)) visibleLinks.push({ source, target })
    }

    // Most notes cite nothing. Drawing them scatters hundreds of unconnected dots
    // across the canvas and squeezes the real network into an unreadable clump,
    // so they are hidden unless explicitly asked for. A search result is always
    // deliberate, so it is exempt.
    if (!showIsolated && !q) {
      const connected = new Set<string>()
      for (const link of visibleLinks) {
        connected.add(link.source)
        connected.add(link.target)
      }
      return {
        nodes: allowed.filter((node) => connected.has(node.id)),
        links: visibleLinks,
      }
    }

    return {
      nodes: allowed.filter((node) => visibleIds.has(node.id)),
      links: visibleLinks,
    }
  }, [graphData, search, showIsolated, tagFilters, visibleObjectTypeSet])

  const focusedNode = useMemo(
    () => graphData.nodes.find((node) => node.id === focusedNodeId) ?? null,
    [focusedNodeId, graphData.nodes],
  )

  // The notes citing the focused chapter — this is the "where is Mark 10
  // referenced" answer, read straight off the edges already in the graph.
  const focusedChapterNotes = useMemo(() => {
    if (!focusedNode || focusedNode.type !== 'scripture-chapter') return []
    const nodeById = new Map(graphData.nodes.map((node) => [node.id, node]))
    const cited: GraphNode[] = []
    const seen = new Set<string>()
    for (const link of graphData.links) {
      if (endpointId(link.target) !== focusedNode.id) continue
      const source = nodeById.get(endpointId(link.source))
      if (!source || seen.has(source.id)) continue
      if (source.type !== 'topic-note' && source.type !== 'daily-note') continue
      seen.add(source.id)
      cited.push(source)
    }
    return cited.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  }, [focusedNode, graphData])

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
    if (focusedNodeId !== node.id) {
      setFocusedNodeId(node.id)
      return
    }
    // Tags have no destination of their own; focusing one is as far as it goes.
    if (!OPENABLE_NODE_TYPES.has(nodeType)) {
      return
    }
    if (onOpenNode) {
      await onOpenNode({ id: node.id, type: nodeType as OpenableNodeType })
    }
  }

  const nodeCanvasSize = 4

  const getNodeLabel = (rawNode: unknown) => {
    if (!rawNode || typeof rawNode !== 'object') return ''
    const node = rawNode as Partial<GraphNode>
    if (!node.label) return ''
    if (node.type === 'scripture-chapter') {
      const notes = node.noteCount ?? 0
      return `${node.label} — ${notes} ${notes === 1 ? 'note' : 'notes'}`
    }
    return node.label
  }

  const getNodeColor = useCallback((rawNode: unknown) => {
    if (!rawNode || typeof rawNode !== 'object') return 'rgba(52, 50, 52, 0.95)'
    const node = rawNode as Partial<GraphNode>
    if (node.id === focusedNodeId) return '#ffffff'
    if (node.type === 'scripture-chapter') {
      return getScriptureSectionColor(node.bookOrder ?? 0)
    }
    // Notes recede so the chapters they cite read as the subject of the graph;
    // the translucent token keeps each type's hue identifiable.
    return getObjectColor(node.type ?? 'topic-note').border
  }, [focusedNodeId])

  // Label the chapters that actually matter — the hubs — plus whatever is focused,
  // so the graph is readable without clicking every dot.
  const labelThreshold = useMemo(() => {
    const counts = graphData.nodes
      .filter((node) => node.type === 'scripture-chapter')
      .map((node) => node.noteCount ?? 0)
      .sort((a, b) => b - a)
    if (counts.length === 0) return Number.POSITIVE_INFINITY
    return counts[Math.min(counts.length - 1, 24)] ?? Number.POSITIVE_INFINITY
  }, [graphData.nodes])

  const drawNode = useCallback((rawNode: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const node = rawNode as Partial<GraphNode> & { x?: number; y?: number }
    if (typeof node.x !== 'number' || typeof node.y !== 'number') return

    const radius = Math.sqrt(Math.max(node.val ?? 1, 0.1)) * nodeCanvasSize
    ctx.beginPath()
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI)
    ctx.fillStyle = getNodeColor(node)
    ctx.fill()

    if (node.id === focusedNodeId) {
      ctx.lineWidth = 2 / globalScale
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
      ctx.stroke()
    }

    const isHub = node.type === 'scripture-chapter' && (node.noteCount ?? 0) >= labelThreshold
    if (!isHub && node.id !== focusedNodeId) return

    const fontSize = Math.max(10 / globalScale, 2.5)
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.fillText(String(node.label ?? ''), node.x, node.y + radius + 1.5 / globalScale)
  }, [focusedNodeId, getNodeColor, labelThreshold])

  const chapterCount = useMemo(
    () => filteredData.nodes.filter((node) => node.type === 'scripture-chapter').length,
    [filteredData.nodes],
  )

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
            {loading
              ? 'Loading graph'
              : `${filteredData.nodes.length} of ${graphData.nodes.length} nodes · ${chapterCount} chapters`}
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
            icon={<Orbit className="h-3.5 w-3.5" />}
            label={showIsolated ? 'Hide unlinked' : 'Show unlinked'}
            selected={showIsolated}
            onClick={() => setShowIsolated((prev) => !prev)}
          />
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
              nodeVal: 'val',
              nodeRelSize: nodeCanvasSize,
              nodeCanvasObject: drawNode,
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

      <div className="mx-3 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-(--color-text-disabled)">
        {SCRIPTURE_SECTIONS.map((section) => (
          <span key={section} className="inline-flex items-center gap-1.5">
            <span
              className="inline-flex h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: getSectionColor(section) }}
            />
            {getScriptureSectionLabel(section)}
          </span>
        ))}
      </div>

      <div className="mx-3 mt-2 rounded-[14px] border border-(--color-border-subtle) bg-(--color-surface-sunken) px-3 py-2 text-sm text-(--color-text-secondary)">
        {focusedNode ? (
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: focusedNode.type === 'scripture-chapter'
                    ? getScriptureSectionColor(focusedNode.bookOrder ?? 0)
                    : getObjectColor(focusedNode.type).accent,
                }}
              />
              <span className="min-w-0 wrap-break-word font-semibold text-(--color-text-primary)">
                {focusedNode.label}
              </span>
            </div>
            {focusedNode.type === 'scripture-chapter' ? (
              <>
                <div className="text-xs uppercase tracking-[0.08em] text-(--color-text-disabled)">
                  {getScriptureSectionLabel(getScriptureSection(focusedNode.bookOrder ?? 0))}
                  {` · ${focusedNode.noteCount ?? 0} ${(focusedNode.noteCount ?? 0) === 1 ? 'note' : 'notes'}`}
                  {` · ${focusedNode.referenceCount ?? 0} ${(focusedNode.referenceCount ?? 0) === 1 ? 'reference' : 'references'}`}
                </div>
                {focusedChapterNotes.length > 0 && (
                  <div className="ui-scroller mt-1 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                    {focusedChapterNotes.map((note) => (
                      <button
                        key={note.id}
                        type="button"
                        onClick={() => {
                          if (!onOpenNode) return
                          void onOpenNode({ id: note.id, type: note.type as OpenableNodeType })
                        }}
                        className="max-w-full truncate rounded-full border border-(--color-border-subtle) bg-(--color-surface-control) px-2.5 py-1 text-xs text-(--color-text-primary) hover:border-(--color-accent-link)"
                      >
                        {note.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs uppercase tracking-[0.08em] text-(--color-text-disabled)">
                {focusedNode.type.replace('-', ' ')}
                {focusedNode.type !== 'tag' && focusedNode.tags && ` · ${focusedNode.tags.length} tags`}
              </div>
            )}
          </div>
        ) : (
          <span>Click a node to focus it, and again to open it. Chapters list every note that cites them.</span>
        )}
      </div>

      <p className="px-4 py-2 text-sm text-(--color-text-disabled)">
        Tip: Drag to pan, scroll to zoom. Node size shows how many notes cite a chapter.
      </p>
    </div>
  )
}
