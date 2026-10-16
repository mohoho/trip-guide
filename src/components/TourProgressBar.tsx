import { useEffect, useRef } from 'react'

export interface TourChapter {
  id: string
  title: string
  stepCount: number
}

interface TourProgressBarProps {
  chapters: TourChapter[]
  cursor: { chapter: number; step: number }
  visible: boolean
  onJumpChapter: (chapterIndex: number) => void
}

/** 对齐 presentation ProgressBar：章=节点，点=slide */
export function TourProgressBar({ chapters, cursor, visible, onJumpChapter }: TourProgressBarProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!visible) return
    activeRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    })
  }, [cursor.chapter, visible])

  if (!visible) return null

  return (
    <div className="absolute bottom-4 left-1/2 z-40 -translate-x-1/2 pointer-events-auto max-w-[min(92vw,720px)]">
      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-black/5 bg-white/95 px-2 py-2 shadow-lg backdrop-blur-md">
        {chapters.map((c, i) => {
          const isActive = i === cursor.chapter
          return (
            <button
              key={c.id}
              ref={isActive ? activeRef : undefined}
              type="button"
              onClick={() => onJumpChapter(i)}
              className={`cursor-pointer shrink-0 rounded-xl px-2.5 py-1.5 text-left transition-colors ${
                isActive ? 'bg-[#eff6ff] text-[#1d4ed8]' : 'hover:bg-[#f3f4f6] text-[#111827]'
              }`}
            >
              <span className="block text-[10px] text-[#9ca3af]">{i + 1}</span>
              <span className="block text-xs whitespace-nowrap">{c.title}</span>
              {isActive && (
                <span className="mt-1 flex gap-1">
                  {Array.from({ length: c.stepCount }, (_, s) => (
                    <span
                      key={s}
                      className={`h-1.5 w-1.5 rounded-full ${
                        s <= cursor.step ? 'bg-[#3b82f6]' : 'bg-[#e5e7eb]'
                      }`}
                    />
                  ))}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
