import type { StoryGraphLayout } from '../lib/storyGraph'

interface StoryGraphViewProps {
  layout: StoryGraphLayout
  selectedId: string | null
  onSelect: (spotId: string) => void
}

function clip(name: string, max = 11): string {
  const chars = Array.from(name)
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : name
}

/**
 * 故事结构图：横向分层，入口在左、故事向右走。
 * 胶囊可点即选中；入口加重描边、结局虚线收口；作者没连过的那条默认边画成虚线。
 */
export function StoryGraphView({ layout, selectedId, onSelect }: StoryGraphViewProps) {
  const byId = new Map(layout.nodes.map((n) => [n.id, n]))

  return (
    <div className="overflow-x-auto">
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label="故事结构图"
        className="block"
      >
        <defs>
          <marker
            id="story-graph-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#cbd5e1" />
          </marker>
        </defs>

        {layout.edges.map((edge) => {
          const from = byId.get(edge.from)
          const to = byId.get(edge.to)
          if (!from || !to) return null
          const sx = from.x + from.width / 2
          const tx = to.x - to.width / 2
          const mx = (sx + tx) / 2
          const active = edge.from === selectedId || edge.to === selectedId
          return (
            <path
              key={`${edge.from}-${edge.to}`}
              d={`M ${sx} ${from.y} L ${mx} ${from.y} L ${mx} ${to.y} L ${tx} ${to.y}`}
              fill="none"
              stroke={active ? '#94a3b8' : '#dbe0e6'}
              strokeWidth={active ? 1.6 : 1.2}
              strokeDasharray={edge.implicit ? '3 3' : undefined}
              markerEnd="url(#story-graph-arrow)"
            />
          )
        })}

        {layout.nodes.map((node) => {
          const selected = node.id === selectedId
          const x = node.x - node.width / 2
          const y = node.y - layout.nodeHeight / 2
          return (
            <g
              key={node.id}
              onClick={() => onSelect(node.id)}
              className="cursor-pointer"
              role="button"
              aria-label={`${node.name}${node.isEntry ? '（入口）' : ''}${node.isEnding ? '（结局）' : ''}`}
            >
              <title>{`${node.name}${node.isEntry ? ' · 入口' : ''}${node.isEnding ? ' · 结局' : ''}`}</title>
              <rect
                x={x}
                y={y}
                width={node.width}
                height={layout.nodeHeight}
                rx={layout.nodeHeight / 2}
                fill={selected ? '#111827' : node.isEnding ? '#f3f4f6' : '#ffffff'}
                stroke={selected ? '#111827' : node.isEntry ? '#111827' : '#d1d5db'}
                strokeWidth={node.isEntry && !selected ? 2 : 1}
                strokeDasharray={node.isEnding && !selected ? '4 3' : undefined}
              />
              <text
                x={node.x}
                y={node.y + 4}
                textAnchor="middle"
                fontSize="12"
                fill={selected ? '#ffffff' : '#374151'}
                fontWeight={node.isEntry || node.isEnding ? 500 : 400}
              >
                {clip(node.name)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
