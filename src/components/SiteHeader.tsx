import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

export type HeaderCta =
  | { label: string; to: string }
  | { label: string; onClick: () => void }

type HeaderBack = { label: string; to: string }

const CTA_CLASS =
  'shrink-0 rounded-[10px] bg-[#111827] px-4 py-2 text-sm font-medium text-white shadow-sm shadow-black/20 transition-colors hover:bg-[#374151]'

const BACK_CLASS =
  'inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 py-2 text-sm text-[#6b7280] transition-colors hover:bg-[#f3f4f6] hover:text-[#111827]'

function BrandMark() {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-[#111827] shadow-sm shadow-black/20">
      {/* 定位针 + 虚线路径：针压在路径末端，图标即「走到哪了」。favicon.svg 是同一版 */}
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path
          d="M4 20.2c3.1-.6 5.2-2.1 6.7-4.5"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeDasharray="0.1 4.4"
        />
        <path
          d="M15.6 3.4c-2.6 0-4.7 2.1-4.7 4.7 0 3.5 4.7 8.9 4.7 8.9s4.7-5.4 4.7-8.9c0-2.6-2.1-4.7-4.7-4.7z"
          fill="white"
        />
        <circle cx="15.6" cy="8" r="1.8" fill="#111827" />
      </svg>
    </span>
  )
}

export function SiteHeader({ back, cta }: { back?: HeaderBack; cta?: HeaderCta }) {
  return (
    <header className="sticky top-0 z-30 border-b border-black/[0.07] bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-[72px] max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link to="/" className="group flex min-w-0 items-center gap-2.5" title="返回首页">
          <BrandMark />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[17px] font-semibold tracking-tight text-[#111827]">程导览</span>
            <span className="block truncate text-[10px] font-medium tracking-[0.2em] text-[#9ca3af]">
              TRIP GUIDE
            </span>
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-1">
          {back ? (
            <Link to={back.to} className={BACK_CLASS}>
              <ArrowLeft size={15} />
              {back.label}
            </Link>
          ) : null}

          {cta ? (
            'to' in cta ? (
              <Link to={cta.to} className={CTA_CLASS}>
                {cta.label}
              </Link>
            ) : (
              <button type="button" onClick={cta.onClick} className={`cursor-pointer ${CTA_CLASS}`}>
                {cta.label}
              </button>
            )
          ) : null}
        </div>
      </div>
    </header>
  )
}
