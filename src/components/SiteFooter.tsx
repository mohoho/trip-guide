export function SiteFooter() {
  return (
    <footer className="journal-footer mt-auto">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-end justify-between gap-6 px-5 py-10 sm:px-10">
        <div><p className="journal-brand-name text-xl tracking-[0.12em]">时空漫游者</p>
          <p className="mt-2 text-[9px] tracking-[0.2em]">SPACETIME WANDERER</p>
          <p className="mt-4 text-xs opacity-70">以脚步丈量风景，以故事收藏时光。</p></div>
        <div className="text-xs leading-7 sm:text-right"><p>TRIP HACKATHON 2026 · 焕新于技 · 第15届</p>
          <p className="opacity-60">© 2026 Trip.com Group · 携程技术</p></div>
      </div>
    </footer>
  )
}
