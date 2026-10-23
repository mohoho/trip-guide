import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

export type HeaderCta =
  | { label: string; to: string }
  | { label: string; onClick: () => void }

type HeaderBack = { label: string; to: string }

const CTA_CLASS =
  'journal-header-cta shrink-0 rounded-full bg-[#315442] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#243f32]'

const BACK_CLASS =
  'inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 py-2 text-sm text-[#72766a] transition-colors hover:bg-[#efeee5] hover:text-[#253c31]'

function BrandMark() {
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#315442]">
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
        <circle cx="15.6" cy="8" r="1.8" fill="#315442" />
      </svg>
    </span>
  )
}

export function SiteHeader({ back, cta }: { back?: HeaderBack; cta?: HeaderCta }) {
  return (
    <header className="journal-header sticky top-0 z-30">
      <div className="mx-auto flex h-[84px] max-w-[1240px] items-center justify-between gap-4 px-5 sm:px-10">
        <Link to="/" className="group flex min-w-0 items-center gap-2.5" title="返回首页">
          <BrandMark />
          <span className="min-w-0 leading-tight">
            <span className="journal-brand-name block truncate text-[21px] font-semibold tracking-[0.08em] text-[#253c31]">时空漫游者</span>
            <span className="mt-1 block truncate text-[8px] font-medium tracking-[0.19em] text-[#777c70]">
              SPACETIME WANDERER
            </span>
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-3 sm:gap-7">
          {!back && <nav className="hidden items-center gap-7 text-xs text-[#626a60] md:flex" aria-label="主导航">
            <Link to="/" className="transition-colors hover:text-[#315442]">探索目的地</Link>
            <Link to="/publish" className="transition-colors hover:text-[#315442]">创作中心</Link>
            <span className="h-3 w-px bg-[#dcded2]" aria-hidden="true" />
          </nav>}
          {back ? (
            <Link to={back.to} className={BACK_CLASS} aria-label={back.label} title={back.label}>
              <ArrowLeft size={15} />
              <span className="hidden sm:inline">{back.label}</span>
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
