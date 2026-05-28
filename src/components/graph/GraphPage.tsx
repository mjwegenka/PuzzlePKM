import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Network, Search, SlidersHorizontal } from 'lucide-react'
import { Input } from '../ui/input'
import FilterChip from '../ui/FilterChip'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { getObject, listDailyNoteMeta, listFileMeta, listHabitMeta, listTopicNoteMeta } from '../../lib/cliService'
import { getObjectDisplayTitle } from '../../lib/objectTypeDefinitions'
import { getObjectColor } from '../../lib/objectColors'
import { itemMatchesTagFilters, type TagFilterState } from '../../lib/tagFilters'

type GraphNodeType = 'topic-note' | 'daily-note' | 'habit' | 'project' | 'ref-material'

interface GraphNode {
  id: string
  type: GraphNodeType
  label: string
  x: number
  y: number
  tags: string[]
}

interface GraphEdge {
  sourceId: string
  targetId: string
}

interface GraphPageProps {
  onOpenNode?: (target: { id: string; type: GraphNodeType }) => void | Promise<void>
  tagFilters?: TagFilterState
}

const GRAPH_OBJECT_TYPE_OPTIONS: Array<{ value: GraphNodeType; label: string; checkedByDefault: boolean }> = [
  { value: 'topic-note', label: 'Topic Notes', checkedByDefault: true },
  { value: 'daily-note', label: 'Daily Notes', checkedByDefault: true },
  { value: 'habit', label: 'Habits', checkedByDefault: true },
  { value: 'project', label: 'Projects', checkedByDefault: true },
  { value: 'ref-material', label: 'Reference Materials', checkedByDefault: true },
]
const DEFAULT_VISIBLE_GRAPH_TYPES = GRAPH_OBJECT_TYPE_OPTIONS
  .filter((option) => option.checkedByDefault)
  .map((option) => option.value)

export default function GraphPage({ onOpenNode, tagFilters = {} }: GraphPageProps) {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [visibleObjectTypes, setVisibleObjectTypes] = useState<GraphNodeType[]>(DEFAULT_VISIBLE_GRAPH_TYPES)
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 })
  const [isPanning, setIsPanning] = useState(false)
  const panStateRef = useRef<null | {
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  }>(null)
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

  useEffect(() => {
    const loadGraph = async () => {
      setLoading(true)
      setError(null)
      try {
        const [topics, dailies, habits, files] = await Promise.all([
          listTopicNoteMeta(),
          listDailyNoteMeta(),
          listHabitMeta(),
          listFileMeta(),
        ])

        const all = [
          ...topics.map((item) => ({
            id: item.id,
            type: 'topic-note' as const,
            label: getObjectDisplayTitle('topic-note', item),
            tags: item.tags ?? [],
          })),
          ...dailies.map((item) => ({
            id: item.id,
            type: 'daily-note' as const,
            label: getObjectDisplayTitle('daily-note', item),
            tags: item.tags ?? [],
          })),
          ...habits.map((item) => ({
            id: item.id,
            type: 'habit' as const,
            label: getObjectDisplayTitle('habit', item),
            tags: item.tags ?? [],
          })),
          ...files.map((item) => ({
            id: item.id,
            type: item.type,
            label: getObjectDisplayTitle(item.type, item),
            tags: item.tags ?? [],
          })),
        ]

        const radius = 210
        const centerX = 320
        const centerY = 240
        const positioned: GraphNode[] = all.map((item, index) => {
          const angle = (index / Math.max(all.length, 1)) * Math.PI * 2
          const ringOffset = 40 * ((index % 3) - 1)
          return {
            ...item,
            x: centerX + Math.cos(angle) * (radius + ringOffset),
            y: centerY + Math.sin(angle) * (radius + ringOffset),
          }
        })

        const nodeIds = new Set(positioned.map((node) => node.id))
        const noteNodes = positioned.filter((node) => node.type === 'topic-note' || node.type === 'daily-note')
        const collectedEdges = new Map<string, GraphEdge>()

        await Promise.all(noteNodes.map(async (node) => {
          try {
            const full = await getObject(node.type, node.id)
            const relationSource = full as unknown as { links?: Array<{ id?: string }> }
            const links = Array.isArray(relationSource.links)
              ? (relationSource.links ?? [])
              : []
            for (const link of links) {
              const targetId = String(link?.id ?? '')
              if (!targetId || !nodeIds.has(targetId)) continue
              const key = `${node.id}->${targetId}`
              collectedEdges.set(key, { sourceId: node.id, targetId })
            }
          } catch {
            // Keep graph usable even if one object fails to load.
          }
        }))

        setNodes(positioned)
        setEdges(Array.from(collectedEdges.values()))
      } catch (err) {
        setError(String(err))
      } finally {
        setLoading(false)
      }
    }

    void loadGraph()
  }, [])

  const filteredNodes = useMemo(() => {
    const q = search.trim().toLowerCase()
    return nodes.filter((node) => {
      if (!visibleObjectTypeSet.has(node.type)) return false
      if (!itemMatchesTagFilters(node.tags, tagFilters)) return false
      if (!q) return true
      return node.label.toLowerCase().includes(q)
    })
  }, [nodes, search, tagFilters, visibleObjectTypeSet])

  const nodeIndex = useMemo(() => {
    const map = new Map<string, GraphNode>()
    for (const node of nodes) map.set(node.id, node)
    return map
  }, [nodes])

  const visibleNodeIds = useMemo(() => new Set(filteredNodes.map((node) => node.id)), [filteredNodes])
  const visibleEdges = useMemo(
    () => edges.filter((edge) => visibleNodeIds.has(edge.sourceId) && visibleNodeIds.has(edge.targetId)),
    [edges, visibleNodeIds],
  )

  const focusedNode = useMemo(
    () => nodes.find((node) => node.id === focusedNodeId) ?? null,
    [focusedNodeId, nodes],
  )

  const handleNodeClick = async (node: GraphNode) => {
    if (focusedNodeId !== node.id) {
      setFocusedNodeId(node.id)
      return
    }
    if (onOpenNode) await onOpenNode({ id: node.id, type: node.type })
  }

  const clampScale = (value: number) => Math.max(0.45, Math.min(2.5, value))

  const handleGraphPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    }
    setIsPanning(true)
  }

  const handleGraphPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panStateRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    const deltaX = event.clientX - pan.startX
    const deltaY = event.clientY - pan.startY
    setViewport((prev) => ({ ...prev, x: pan.originX + deltaX, y: pan.originY + deltaY }))
  }

  const stopGraphPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panStateRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    panStateRef.current = null
    setIsPanning(false)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handleGraphWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const scaleFactor = event.deltaY < 0 ? 1.1 : 0.9
    setViewport((prev) => ({ ...prev, scale: clampScale(prev.scale * scaleFactor) }))
  }

  return (
    <div className="ui-shell-panel flex min-h-0 flex-1 flex-col bg-[var(--color-surface-elevated)]">
      <div className="ui-toolbar-panel mb-3 flex min-h-[68px] shrink-0 flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-[180px] flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.1em] text-[var(--color-text-disabled)]">
            <Network className="h-3.5 w-3.5" />
            Graph
          </div>
          <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {loading ? 'Loading graph' : `${filteredNodes.length} of ${nodes.length} nodes`}
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
        </div>
        <div className="relative w-[248px] max-w-full shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-disabled)]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search nodes"
            className="h-10 rounded-[10px] pl-10 pr-4 text-sm"
          />
        </div>
      </div>

      {error && (
        <div className="mb-1 rounded-md border border-[var(--color-destructive)]/35 bg-[var(--color-destructive)]/8 px-2 py-1 text-xs text-[var(--color-destructive)]">
          {error}
        </div>
      )}

      <div
        onPointerDown={handleGraphPointerDown}
        onPointerMove={handleGraphPointerMove}
        onPointerUp={stopGraphPan}
        onPointerCancel={stopGraphPan}
        onWheel={handleGraphWheel}
        className="relative mx-3 min-h-0 flex-1 overflow-hidden rounded-[18px] border"
        style={{
          borderColor: isPanning ? 'var(--color-accent-selected)' : 'var(--color-border-subtle)',
          backgroundColor: 'rgba(26, 22, 18, 0.6)',
          cursor: isPanning ? 'grabbing' : 'grab',
        }}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--color-text-secondary)]" />
          </div>
        ) : (
          <svg width="100%" height="100%" viewBox="0 0 640 480" preserveAspectRatio="xMidYMid meet">
            <g transform={`translate(${viewport.x} ${viewport.y}) translate(320 240) scale(${viewport.scale}) translate(-320 -240)`}>
            {visibleEdges.map((edge) => {
              const source = nodeIndex.get(edge.sourceId)
              const target = nodeIndex.get(edge.targetId)
              if (!source || !target) return null
              return (
                <line
                  key={`${edge.sourceId}:${edge.targetId}`}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke="rgba(221, 181, 80, 0.18)"
                  strokeWidth={1}
                />
              )
            })}
            {filteredNodes.map((node) => {
              const focused = node.id === focusedNodeId
              const colors = getObjectColor(node.type)
              return (
                <g key={node.id} data-node="true" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void handleNodeClick(node) }}>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={focused ? 9 : 7}
                    fill={focused ? colors.bg : 'rgba(52, 50, 52, 0.95)'}
                    stroke={focused ? colors.accent : colors.border}
                    strokeWidth={focused ? 2 : 1.5}
                  />
                </g>
              )
            })}
            </g>
          </svg>
        )}
      </div>

      <div className="mx-3 mt-3 rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
        {focusedNode ? (
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: getObjectColor(focusedNode.type).accent }}
              />
              <span className="min-w-0 break-words font-semibold text-[var(--color-text-primary)]">
                {focusedNode.label}
              </span>
            </div>
            <div className="text-xs uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
              {focusedNode.type.replace('-', ' ')} · {focusedNode.tags.length} tags
            </div>
          </div>
        ) : (
          <span>Click a node to show its full label and details here.</span>
        )}
      </div>

      <p className="px-4 py-2 text-sm text-[var(--color-text-disabled)]">
        Tip: drag to pan, use trackpad/pointer wheel to zoom, click a node once to focus it and again to open.
      </p>
    </div>
  )
}
