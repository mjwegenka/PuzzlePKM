import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Box, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import HubIcon from '@mui/icons-material/Hub'
import SearchIcon from '@mui/icons-material/Search'
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
  const theme = useTheme()
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasFocus, setHasFocus] = useState(false)
  const [search, setSearch] = useState('')
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)

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
    if (!hasFocus) return
    if (focusedNodeId !== node.id) {
      setFocusedNodeId(node.id)
      return
    }
    if (onOpenNode) await onOpenNode({ id: node.id, type: node.type })
  }

  return (
    <Paper sx={{ flex: 1, minHeight: 0, p: 1.5, bgcolor: 'surface.elevated', border: '1px solid', borderColor: 'border.subtle', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, flexShrink: 0 }}>
        <HubIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
        <Typography variant="subtitle2" sx={{ color: 'text.primary', fontWeight: 700 }}>Graph</Typography>
        <TextField
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search nodes..."
          sx={{ ml: 'auto', width: 260 }}
          slotProps={{
            input: {
              startAdornment: <SearchIcon sx={{ fontSize: 14, color: 'text.disabled', mr: 0.5 }} />,
            },
          }}
        />
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

      <Box
        onClick={() => setHasFocus(true)}
        sx={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          border: '1px solid',
          borderColor: hasFocus ? 'accent.selected' : 'border.subtle',
          borderRadius: 1,
          bgcolor: (localTheme) => alpha(localTheme.palette.surface.app, 0.45),
          overflow: 'hidden',
          cursor: hasFocus ? 'default' : 'pointer',
        }}
      >
        {loading ? (
          <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <svg width="100%" height="100%" viewBox="0 0 640 480" preserveAspectRatio="xMidYMid meet">
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
                  stroke={alpha(theme.palette.text.secondary, 0.35)}
                  strokeWidth={1}
                />
              )
            })}
            {filteredNodes.map((node) => {
              const focused = node.id === focusedNodeId
              return (
                <g key={node.id} onClick={(event) => { event.stopPropagation(); void handleNodeClick(node) }}>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={focused ? 12 : 9}
                    fill={focused ? theme.palette.accent.selected : theme.palette.surface.app}
                    stroke={focused ? theme.palette.success.main : theme.palette.text.secondary}
                    strokeWidth={focused ? 2 : 1}
                  />
                  <text
                    x={node.x + 14}
                    y={node.y + 4}
                    fill={theme.palette.text.secondary}
                    style={{ fontSize: '11px', userSelect: 'none' }}
                  >
                    {node.label.slice(0, 28)}
                  </text>
                </g>
              )
            })}
          </svg>
        )}

        {!hasFocus && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: (localTheme) => alpha(localTheme.palette.surface.app, 0.75) }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Click to focus graph
            </Typography>
          </Box>
        )}
      </Box>

      <Typography variant="caption" sx={{ color: 'text.disabled', mt: 1 }}>
        Tip: click a node once to focus it, click it again to open in a new tab.
      </Typography>
    </Paper>
  )
}
