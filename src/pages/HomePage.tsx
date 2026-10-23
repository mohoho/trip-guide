import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight, Compass, Headphones, Route } from 'lucide-react'
import { ModeTag } from '../components/ModeTag'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import type { CatalogItem, TourMode } from '../lib/tourPackage'
import { loadCatalog } from '../lib/catalog'

type ModeFilter = 'all' | TourMode
const FILTERS: Array<{ value: ModeFilter; label: string }> = [
  { value: 'all', label: '全部目的地' },
  { value: 'checkin', label: '打卡漫游' },
  { value: 'story', label: '故事探索' },
]

export function HomePage() {
  const [list, setList] = useState<CatalogItem[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState<ModeFilter>('all')

  useEffect(() => {
    loadCatalog()
      .then((items) => {
        // 以园林打卡开篇，故事目的地仍按原有发布顺序排列。
        setList([...items.filter((item) => item.mode !== 'story'), ...items.filter((item) => item.mode === 'story')])
      })
      .catch((e) => setError(e instanceof Error ? e.message : '目录加载失败'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (paused || list.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % list.length), 7000)
    return () => window.clearInterval(timer)
  }, [paused, list.length])

  const active = Math.min(index, Math.max(0, list.length - 1))
  const featured = list[active]
  const destinations = list.filter((item) => filter === 'all' || (item.mode || 'checkin') === filter)

  return (
    <div className="journal-page">
      <SiteHeader cta={{ label: '发布后台', to: '/publish' }} />
      <main>
        <section className="journal-hero" aria-label="精选漫游"
          onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false) }}>
          <div className="journal-hero-copy">
            <p className="journal-eyebrow"><span /> THE ART OF WANDERING</p>
            <h1>让每一步，<br />都有<span>故事。</span></h1>
            <p className="journal-hero-intro">走进风景，也走进风景里的故事。<br />跟随地图与声音，发现沿途的小小惊喜。</p>
            <div className="journal-poem"><span aria-hidden="true">漫<br />游</span><p>在时光的庭院里<br />遇见更大的世界</p></div>
            {featured && <Link to={`/tour/${featured.id}`} className="journal-primary">开始漫游 <ArrowRight size={17} /></Link>}
            <div className="journal-hero-bottom">
              {list.length > 1 && <div className="journal-pagination" aria-label="切换精选目的地">
                {list.map((item, i) => <button type="button" key={item.id}
                  aria-label={`切换到 ${item.name}`} aria-pressed={i === active}
                  className={i === active ? 'is-active' : ''} onClick={() => setIndex(i)}>
                  {String(i + 1).padStart(2, '0')}<span /></button>)}
              </div>}
              <a href="#destinations" className="journal-scroll" aria-label="浏览精选目的地"
                onClick={(event) => { event.preventDefault(); document.getElementById('destinations')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }) }}>
                <ArrowDown size={15} /> 向下探索
              </a>
            </div>
          </div>
          <div className="journal-hero-visual">
            {featured ? <>
              <img key={featured.id} src={featured.coverImage} alt={featured.name} className="journal-hero-image" />
              <span className="journal-image-note">一处风景 / 一段旅程</span>
              <Link to={`/tour/${featured.id}`} className="journal-feature-caption">
                <div><span>本期漫游 · {featured.mode === 'story' ? '故事探索' : '打卡漫游'}</span><h2>{featured.name}</h2></div>
                <span className="journal-circle"><ArrowRight size={20} /></span>
              </Link>
            </> : <div className="journal-hero-placeholder"><Compass size={48} strokeWidth={1} /><p>{error ? '暂时无法加载目的地' : loading ? '正在寻找沿途风景…' : '期待下一段旅程'}</p></div>}
          </div>
        </section>

        <section className="journal-destinations" id="destinations">
          <div className="journal-section-heading">
            <div><p className="journal-eyebrow">CURATED JOURNEYS</p><h2>下一站，去哪里<span>？</span></h2></div>
            <p>不必远行，也能发现新的世界。<br /><span>{list.length} 处目的地，等你慢慢探索</span></p>
          </div>
          <div className="journal-filter-row">
            <div className="journal-filters" role="group" aria-label="按漫游模式筛选">
              {FILTERS.map((entry) => <button key={entry.value} type="button" aria-pressed={filter === entry.value}
                className={filter === entry.value ? 'is-active' : ''} onClick={() => setFilter(entry.value)}>{entry.label}</button>)}
            </div><span className="journal-count">{String(destinations.length).padStart(2, '0')} / 目的地</span>
          </div>
          {error ? <div role="alert" className="journal-empty">{error}</div>
            : loading ? <div className="journal-empty" role="status">正在加载目的地…</div>
            : destinations.length === 0 ? <div className="journal-empty">{list.length ? '这个分类还没有目的地，看看其他漫游吧。' : '暂无已发布目的地，下一段旅程即将开始。'}</div>
            : <div className="journal-destination-grid">
              {destinations.map((item, i) => <Link key={item.id} to={`/tour/${item.id}`} className="journal-destination-card">
                <div className="journal-card-image"><img src={item.coverImage} alt={item.name} loading="lazy" /><span className="journal-card-mode"><ModeTag mode={item.mode} /></span><span className="journal-card-number">JOURNEY / {String(i + 1).padStart(2, '0')}</span></div>
                <div className="journal-card-copy"><div className="journal-card-title"><h3>{item.name}</h3><ArrowRight size={21} strokeWidth={1.4} /></div>
                  {item.storyTitle && <p className="journal-story-title">{item.storyTitle}</p>}
                  <p className="journal-card-description">{item.description}</p>
                  <span className="journal-card-action">{item.mode === 'story' ? '走进故事，选择你的下一步' : '沿着路线，边走边听'} <ArrowRight size={14} /></span>
                </div>
              </Link>)}
            </div>}
        </section>

        <section className="journal-about" id="wander-guide" aria-label="漫游指南">
          <div className="journal-about-heading"><p className="journal-eyebrow">WANDER YOUR WAY</p><h2>慢一点，<br />风景会说话。</h2><p>把旅程交给好奇心，<br />把沿途的故事交给我们。</p></div>
          <div className="journal-guide"><Compass size={25} strokeWidth={1.3} /><span>01 / 发现</span><h3>选一处心动的风景</h3><p>从目的地出发，走进一座园林，或开启一场未知的冒险。</p></div>
          <div className="journal-guide"><Headphones size={25} strokeWidth={1.3} /><span>02 / 聆听</span><h3>听见风景里的故事</h3><p>跟随地图漫游，抵达节点展开讲解，让每一站都值得停留。</p></div>
          <div className="journal-guide"><Route size={25} strokeWidth={1.3} /><span>03 / 探索</span><h3>走出自己的旅程</h3><p>按路线打卡，或在故事路口做出选择，以喜欢的方式探索。</p></div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
