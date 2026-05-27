import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Network, Search } from 'lucide-react'
import { Input } from '../ui/input'
import { getObject, listDailyNoteMeta, listFileMeta, listHabitMeta, listTopicNoteMeta } from '../../lib/cliService'

type GraphNodeType = 'topic-note' | 'daily-note' | 'habit' | 'project' | 'ref-material'

interface GraphNode {
  id: string
  type: GraphNodeType
  label: string
  x: number
  y: number
}

interface GraphEdge {
  sourceId: string
  targetId: string
}

interface GraphPageProps {
  onOpenNode?: (target: { id: string; type: GraphNodeType }) => void | Promise<void>
}

export default function GraphPage({ onOpenNode }: GraphPageProps) {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 })
  const [isPanning, setIsPanning] = useState(false)
  const panStateRef = useRef<null | {
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  }>(null)

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
          ...topics.map((item) => ({ id: item.id, type: 'topic-note' as const, label: item.title || item.date || 'Topic Note' })),
          ...dailies.map((item) => ({ id: item.id, type: 'daily-note' as const, label: item.date || 'Daily Note' })),
          ...habits.map((item) => ({ id: item.id, type: 'habit' as const, label: item.text || item.date || 'Habit' })),
          ...files.map((item) => ({ id: item.id, type: item.type, label: item.name || 'File' })),
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
    if (!q) return nodes
    return nodes.filter((node) => node.label.toLowerCase().includes(q))
  }, [nodes, search])

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
    <div className="flex min-h-0 flex-1 flex-col rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-1.5">
      <div className="mb-1 flex shrink-0 items-center gap-2">
        <Network className="h-[18px] w-[18px] text-[var(--color-text-secondary)]" />
        <h2 className="text-sm font-bold text-[var(--color-text-primary)]">Graph</h2>
        <div className="relative ml-auto w-[260px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-disabled)]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search nodes..."
            className="h-8 border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] pl-8 text-xs text-[var(--color-text-secondary)]"
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
        className="relative min-h-0 flex-1 overflow-hidden rounded-sm border"
        style={{
          borderColor: isPanning ? 'var(--color-accent-selected)' : 'var(--color-border-subtle)',
          backgroundColor: 'rgba(2, 6, 23, 0.45)',
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
                  stroke="rgba(148, 163, 184, 0.35)"
                  strokeWidth={1}
                />
              )
            })}
            {filteredNodes.map((node) => {
              const focused = node.id === focusedNodeId
              return (
                <g key={node.id} data-node="true" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void handleNodeClick(node) }}>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={focused ? 8 : 6}
                    fill={focused ? 'var(--color-accent-selected)' : 'var(--color-surface-app)'}
                    stroke={focused ? 'var(--color-success-main)' : 'var(--color-text-secondary)'}
                    strokeWidth={focused ? 2 : 1}
                  />
                  <text
                    x={node.x + 10}
                    y={node.y + 3}
                    fill="var(--color-text-secondary)"
                    style={{ fontSize: '10px', userSelect: 'none' }}
                  >
                    {node.label.slice(0, 28)}
                  </text>
                </g>
              )
            })}
            </g>
          </svg>
        )}
      </div>

      <p className="mt-1 text-[11px] text-[var(--color-text-disabled)]">
        Tip: drag to pan, use trackpad/pointer wheel to zoom, click a node once to focus it and again to open.
      </p>
    </div>
  )
}
