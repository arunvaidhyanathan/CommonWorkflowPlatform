// Element palette (Designer.html Section 5.2): categorized by the OMG
// element taxonomy for the active spec, drag-to-canvas and click-to-place.
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { getPaletteItems } from '../nodes/nodeTypes'

const CATEGORIES_BY_SPEC: Record<'BPMN' | 'CMMN', string[]> = {
  BPMN: ['Events', 'Activities', 'Gateways'],
  CMMN: ['Plan Items', 'Sentries'],
}

interface PaletteProps {
  onPlace: (type: string) => void
}

export function Palette({ onPlace }: PaletteProps) {
  const activeSpec = useWorkbenchStore((s) => s.activeSpec)
  const paletteItems = getPaletteItems(activeSpec)
  const categories = CATEGORIES_BY_SPEC[activeSpec === 'CMMN' ? 'CMMN' : 'BPMN']

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <aside className="w-56 shrink-0 overflow-y-auto border-r border-sky-200 bg-sky-50 p-3">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-sky-900">
        Palette &middot; {activeSpec}
      </h2>
      {categories.map((category) => (
        <div key={category} className="mb-4">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {category}
          </div>
          <div className="flex flex-col gap-1.5">
            {paletteItems
              .filter((item) => item.category === category)
              .map((item) => (
                <button
                  key={item.type}
                  type="button"
                  draggable
                  onDragStart={(e) => onDragStart(e, item.type)}
                  onClick={() => onPlace(item.type)}
                  className="cursor-grab rounded border border-sky-200 bg-white px-2 py-1.5 text-left text-xs text-slate-700 shadow-sm hover:border-sky-400 hover:bg-sky-100 active:cursor-grabbing"
                  title="Drag onto the canvas, or click to place"
                >
                  {item.label}
                </button>
              ))}
          </div>
        </div>
      ))}
    </aside>
  )
}
