import { useRef } from 'react'
import { ImagePlus } from 'lucide-react'
import mascot from '../assets/visitor.png'

/**
 * 游客头像：导览页地图上那枚圆牌。不上传就是内置吉祥物，
 * 上传过的还可以「恢复默认」退回吉祥物。故事模式里这枚标记是「你」，所以那边叫角色头像。
 */
export function VisitorAvatarPicker({
  value,
  label = '游客头像',
  onUpload,
  onReset,
}: {
  value?: string
  label?: string
  onUpload: (file: File) => void
  onReset: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="text-xs text-[#9ca3af] shrink-0">{label}</span>
      <span className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-black/10 bg-white">
        <img src={value || mascot} alt="" className="h-full w-full object-cover" />
      </span>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="inline-flex items-center gap-1 text-xs text-[#3b82f6] shrink-0"
      >
        <ImagePlus size={13} />
        上传
      </button>
      {value && (
        <button type="button" onClick={onReset} className="text-xs text-[#9ca3af] shrink-0">
          恢复默认
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onUpload(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
