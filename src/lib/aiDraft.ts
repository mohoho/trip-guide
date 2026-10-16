import { newSpotFromCandidate } from './draftStore'
import type { DraftAttraction, Spot } from '../types/attraction'
import type { LngLat } from './tourPackage'

const OFFSETS: LngLat[] = [
  { lng: -0.00035, lat: 0.00012 },
  { lng: -0.00015, lat: 0.00035 },
  { lng: 0.00018, lat: -0.00008 },
  { lng: 0.00005, lat: 0.00048 },
  { lng: 0.00055, lat: -0.00055 },
]

type AiSpotDraft = {
  name: string
  poetic?: string
  searchHint?: string
  slides?: Array<{
    title?: string
    bullets?: string[]
    narration?: string
  }>
}

/** 用户勾选的候选地点：节点数量与顺序以它为准 */
export type GenerateTarget = {
  name: string
  lng: number
  lat: number
  address?: string
}

export type GenerateDraftInput = Pick<
  DraftAttraction,
  'name' | 'description' | 'start' | 'city' | 'amapContext'
> & {
  /** 给了 targets 就严格按这个列表生成节点（数量、顺序、坐标都以它为准） */
  targets?: GenerateTarget[]
}

function mockSpots(attraction: GenerateDraftInput): Spot[] {
  const base = attraction.name.replace(/\s+/g, '') || '景点'
  const targets = attraction.targets ?? []
  const fromContext =
    attraction.amapContext
      ?.split('\n')
      .filter((l) => /^\d+\./.test(l.trim()))
      .map((l) => l.replace(/^\d+\.\s*/, '').split(' · ')[0]?.trim())
      .filter(Boolean) || []
  const names =
    targets.length > 0
      ? targets.map((t) => t.name)
      : fromContext.length >= 3
        ? fromContext.slice(0, 5)
        : [`${base}入口`, `${base}主景`, `${base}庭院`, `${base}碑亭`, `${base}出口`]
  const count = targets.length > 0 ? targets.length : Math.min(5, Math.max(3, names.length))
  const center = attraction.start
  return Array.from({ length: count }, (_, i) => {
    const off = OFFSETS[i % OFFSETS.length]
    const name = names[i]
    const target = targets[i]
    return {
      id: `draft-${Date.now().toString(36)}-${i}`,
      name,
      poetic: `${attraction.name} · 第 ${i + 1} 站`,
      lng: target ? target.lng : center.lng + off.lng,
      lat: target ? target.lat : center.lat + off.lat,
      triggerRadiusMeters: 38,
      image: '/spots/map-intro.jpg',
      imageCredit: '',
      searchHint: `${attraction.city || ''} ${attraction.name} ${name}`.trim(),
      slides: [
        {
          title: name,
          bullets: [
            attraction.description.slice(0, 36) || `${attraction.name}的重要停驻点`,
            '可结合高德地点信息完善讲解',
            '地图上可拖动校准坐标',
          ],
          narration: `欢迎来到${attraction.name}。我们现在来到${name}，请稍作停留，感受这里的气息。`,
        },
      ],
    }
  })
}

/**
 * 补全被截断的 JSON：按栈关闭未闭合的 `[` / `{`，必要时先闭合被截断的字符串。
 * 括号不匹配或无法安全补全时返回 null。
 */
function closeTruncatedJson(src: string): string | null {
  const stack: string[] = []
  let inStr = false
  let esc = false
  for (const ch of src) {
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') {
      const open = stack.pop()
      if (!open || (open === '{') !== (ch === '}')) return null
    }
  }
  let out = src
  if (inStr) {
    if (esc) out = out.slice(0, -1)
    out += '"'
  }
  out = out.replace(/[\s,]+$/, '')
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']'
  return out
}

/**
 * 从模型输出里抠出 JSON。
 * 先整体解析；失败说明输出被 max_tokens 截断，则从后往前在每个 `}` 处切一刀、
 * 补齐括号后重试，取第一个能解析出 spots 的结果（把已生成完的节点救回来）。
 */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = (fenced?.[1] || text).trim()
  const start = raw.indexOf('{')
  if (start < 0) throw new Error('AI 未返回 JSON')
  const body = raw.slice(start)

  const end = body.lastIndexOf('}')
  if (end > 0) {
    try {
      return JSON.parse(body.slice(0, end + 1))
    } catch {
      // 落到下面的截断修复
    }
  }

  for (let i = body.lastIndexOf('}'); i > 0; i = body.lastIndexOf('}', i - 1)) {
    const repaired = closeTruncatedJson(body.slice(0, i + 1))
    if (!repaired) continue
    try {
      const parsed = JSON.parse(repaired) as { spots?: unknown }
      if (Array.isArray(parsed.spots) && parsed.spots.length > 0) return parsed
    } catch {
      // 这一刀不行，继续往前切
    }
  }

  throw new Error('AI 返回的 JSON 无法解析（可能被截断）')
}

function toSpots(attraction: GenerateDraftInput, drafts: AiSpotDraft[]): Spot[] {
  const center = attraction.start
  return drafts.slice(0, 8).map((d, i) => {
    const off = OFFSETS[i % OFFSETS.length]
    const name = (d.name || `节点 ${i + 1}`).trim()
    const slide = d.slides?.[0]
    const hint = (
      d.searchHint ||
      `${attraction.city || ''} ${attraction.name} ${name}`.trim()
    ).trim()
    return {
      id: `draft-${Date.now().toString(36)}-${i}`,
      name,
      poetic: (d.poetic || `${attraction.name} · 第 ${i + 1} 站`).trim(),
      lng: center.lng + off.lng,
      lat: center.lat + off.lat,
      triggerRadiusMeters: 38,
      image: '/spots/map-intro.jpg',
      imageCredit: '',
      searchHint: hint,
      slides: [
        {
          title: (slide?.title || name).trim(),
          bullets:
            Array.isArray(slide?.bullets) && slide!.bullets!.length > 0
              ? slide!.bullets!.map((b) => String(b).trim()).filter(Boolean).slice(0, 5)
              : [`${name}是${attraction.name}的重要停驻点`],
          narration: (
            slide?.narration || `欢迎来到${attraction.name}。这里是${name}，请稍作停留。`
          ).trim(),
        },
      ],
    } as Spot
  })
}

export type GenerateDraftResult = {
  spots: Spot[]
  /** 'ai' = 真实模型返回；'mock' = 本地兜底模板 */
  source: 'ai' | 'mock'
  /** source 为 'mock' 时的原因，便于在界面上明示 */
  reason?: string
}

/**
 * 把 AI 产出的节点对齐到勾选的候选列表 —— 数量、顺序、坐标都以候选为准。
 * 先按名称匹配 AI 节点（再按包含关系、再按同位置兜底）；候选没匹配上的用占位节点补；
 * AI 多出来的节点直接丢弃。
 */
function alignToTargets(attraction: GenerateDraftInput, generated: Spot[]): Spot[] {
  const targets = attraction.targets ?? []
  if (targets.length === 0) return generated

  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  const pool = generated.map((spot) => ({ spot, used: false }))
  const stamp = Date.now().toString(36)

  return targets.map((t, i) => {
    let hit = pool.find((p) => !p.used && norm(p.spot.name) === norm(t.name))
    if (!hit) {
      hit = pool.find(
        (p) =>
          !p.used &&
          (norm(p.spot.name).includes(norm(t.name)) || norm(t.name).includes(norm(p.spot.name))),
      )
    }
    if (!hit && pool[i] && !pool[i].used) hit = pool[i]
    if (hit) hit.used = true

    const base = hit
      ? hit.spot
      : newSpotFromCandidate(
          { name: t.name, location: { lng: t.lng, lat: t.lat }, address: t.address },
          i,
        )
    return {
      ...base,
      id: `spot-${stamp}-${i + 1}`,
      name: base.name || t.name,
      lng: t.lng,
      lat: t.lat,
      searchHint: base.searchHint || `${attraction.city || ''} ${attraction.name} ${t.name}`.trim(),
    }
  })
}

/** 调用 DeepSeek；把高德地点上下文一并输入。失败回落 mock */
export async function generateDraftSpots(
  attraction: GenerateDraftInput,
): Promise<GenerateDraftResult> {
  const baseUrl = import.meta.env.VITE_DEEPSEEK_BASE_URL
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY
  const model = import.meta.env.VITE_DEEPSEEK_MODEL || 'deepseek-chat'

  if (!baseUrl || !apiKey) {
    return {
      spots: mockSpots(attraction),
      source: 'mock',
      reason: '未配置 VITE_DEEPSEEK_BASE_URL / VITE_DEEPSEEK_API_KEY',
    }
  }

  const targets = attraction.targets ?? []
  const system = `你是文旅导览内容策划。根据景点信息与高德地图检索到的真实地点，生成${
    targets.length > 0 ? `严格 ${targets.length} 个` : ' 3～4 个'
  }导览节点。${
    targets.length > 0
      ? '\n必须与「本次必须覆盖的地点」逐一对应（名称与顺序一致），不要增加、删除、合并或替换节点。'
      : ''
  }
优先选用高德返回的真实地点名称与游览顺序；可补充必要过渡点，但不要编造不存在的建筑。
只输出一个 JSON 对象，不要其它说明。格式：
{
  "spots": [
    {
      "name": "节点中文名（尽量与高德地点名一致）",
      "poetic": "简短诗意副标题",
      "searchHint": "用于高德地图检索的关键词，含城市与景点名，如：上海 豫园 三穗堂",
      "slides": [
        {
          "title": "讲解标题",
          "bullets": ["要点1", "要点2", "要点3"],
          "narration": "约60～100字口语讲解稿，可融入地点类型/地址信息"
        }
      ]
    }
  ]
}`

  const user = `景点名称：${attraction.name}
城市/区域：${attraction.city || '（未知）'}
简介：${attraction.description || '（无）'}

【高德地图地点信息】
${attraction.amapContext || '（暂无，请按常识规划合理游览顺序）'}

${targets.length > 0 ? `\n【本次必须覆盖的地点（共 ${targets.length} 个，按此顺序各生成 1 个节点）】\n${targets.map((t, i) => `${i + 1}. ${t.name}`).join('\n')}\n` : ''}
请基于以上高德地点生成实地可走的导览节点；searchHint 要便于再次地图定位。`

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: false,
        temperature: 0.7,
        max_tokens: 8192,
      }),
    })
    if (!res.ok) throw new Error(`AI HTTP ${res.status}`)
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
    }
    const choice = data.choices?.[0]
    const content = choice?.message?.content?.trim()
    if (!content) throw new Error('AI 无内容')
    const truncated = choice?.finish_reason === 'length'

    let parsed: { spots?: AiSpotDraft[] }
    try {
      parsed = extractJson(content) as { spots?: AiSpotDraft[] }
    } catch (e) {
      throw truncated
        ? new Error('AI 输出被截断（max_tokens 不足），未取到完整 JSON')
        : e
    }
    if (!Array.isArray(parsed.spots) || parsed.spots.length === 0) {
      throw new Error('AI JSON 无 spots')
    }
    if (truncated) console.warn('[aiDraft] 输出被截断，已用完整部分解析出节点')
    return { spots: alignToTargets(attraction, toSpots(attraction, parsed.spots)), source: 'ai' }
  } catch (e) {
    const reason = e instanceof Error ? e.message : '未知错误'
    console.warn('[aiDraft] fallback mock:', reason, e)
    return { spots: mockSpots(attraction), source: 'mock', reason }
  }
}
