import type { Slide } from './tourPackage'

/**
 * 打卡模式的上下文：景点简介与逐个节点的讲解是**两段独立的请求**，
 * 所以两处都要带上同一份「这个景点现在长什么样」。
 */
export type CheckinFields = {
  name: string
  /** 景点简介：简介段负责重写它，节点段拿它当上下文 */
  description: string
  city?: string
  amapContext?: string
  spots: Array<{ name: string }>
}

/**
 * 故事模式的上下文：结构、开场、逐节点情节是三段**独立的请求**，
 * 所以三处都要带上同一份「这个故事现在长什么样」。
 */
export type StoryFields = {
  name: string
  /** 前情提要：开场段负责重写它，节点段拿它当上下文 */
  description: string
  city?: string
  amapContext?: string
  /** 创作方向（主线、语气、意象），会整段进 prompt */
  direction?: string
  spots: Array<{ name: string }>
  /** 按 **与 spots 相同的顺序** 给出每个节点的生效去向与是否结局 */
  nodes: Array<{ name: string; to: string[]; ending: boolean }>
  entry?: string
}

/** 一个去向上的字：label 是点的那句话，note 是一行小字 */
export type WrittenChoice = { label: string; note: string }

export type WrittenSpotContent = {
  poetic: string
  slides: Slide[]
  /** 与输入里该节点的 `to` 一一对应；打卡模式为空数组 */
  choices: WrittenChoice[]
  /** 结局标题；该节点不是结局时为空串 */
  endingTitle: string
}

/** AI 重排出的新走向：全是节点名，调用方要映射回 spot id 才能落盘 */
export type WrittenStoryStructure = {
  /** 入口节点名；AI 没给或对不上时缺省 */
  entry?: string
  /** 与 input.spots 同顺序、覆盖全部节点 */
  nodes: Array<{ name: string; to: string[] }>
}

type AiContentDraft = {
  poetic?: string
  slides?: Array<{
    title?: string
    bullets?: string[]
    narration?: string
  }>
  choices?: Array<{ label?: string; note?: string }>
  endingTitle?: string
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
 * 从模型输出里抠出 JSON。传了 `key` 就要求它是个非空数组。
 * 先整体解析；失败说明输出被 max_tokens 截断，则从后往前在每个 `}` 处切一刀、
 * 补齐括号后重试，取第一个能解析出 key 的结果（把已生成完的部分救回来）。
 */
function extractJson(text: string, key?: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = (fenced?.[1] || text).trim()
  const start = raw.indexOf('{')
  if (start < 0) throw new Error('AI 未返回 JSON')
  const body = raw.slice(start)

  const end = body.lastIndexOf('}')
  if (end > 0) {
    try {
      return JSON.parse(body.slice(0, end + 1)) as Record<string, unknown>
    } catch {
      // 落到下面的截断修复
    }
  }

  for (let i = body.lastIndexOf('}'); i > 0; i = body.lastIndexOf('}', i - 1)) {
    const repaired = closeTruncatedJson(body.slice(0, i + 1))
    if (!repaired) continue
    try {
      const parsed = JSON.parse(repaired) as Record<string, unknown>
      if (!key || (Array.isArray(parsed[key]) && parsed[key].length > 0)) return parsed
    } catch {
      // 这一刀不行，继续往前切
    }
  }

  throw new Error('AI 返回的 JSON 无法解析（可能被截断）')
}

/** 单个节点的兜底内容（未接通 AI、或某一段缺失时用） */
function templateContent(
  input: { name: string; description: string },
  index: number,
  nodeName: string,
  node: { to: string[]; ending: boolean } | undefined,
  story: boolean,
): WrittenSpotContent {
  return {
    poetic: `${input.name} · 第 ${index + 1} 站`,
    slides: [
      {
        title: nodeName,
        bullets: [
          input.description.slice(0, 36) || `${nodeName}是${input.name}的重要停驻点`,
          '可结合高德地点信息完善讲解',
          '地图上可拖动校准坐标',
        ],
        narration: story
          ? `你来到${nodeName}，停下脚步。这一段情节还没有人写——先记下这一站，回头补上。`
          : `欢迎来到${input.name}。我们现在来到${nodeName}，请稍作停留，感受这里的气息。`,
      },
    ],
    choices: (node?.to || []).map((name) => ({ label: `前往${name}`, note: '' })),
    endingTitle: node?.ending ? `结局 · ${nodeName}` : '',
  }
}

/** AI 的一段内容 → 节点内容；缺失的字段逐项回落模板 */
function toContent(
  draft: AiContentDraft | undefined,
  input: { name: string; description: string },
  index: number,
  nodeName: string,
  node: { to: string[]; ending: boolean } | undefined,
  story: boolean,
): WrittenSpotContent {
  const tpl = templateContent(input, index, nodeName, node, story)
  if (!draft) return tpl
  const slide = draft.slides?.[0]
  const bullets = Array.isArray(slide?.bullets)
    ? slide.bullets.map((b) => String(b).trim()).filter(Boolean).slice(0, 5)
    : []
  // 数量对得上就整套用 AI 的（允许它为某个去向留空、由前台兜底），对不上就整段回落模板
  const aiChoices = Array.isArray(draft.choices) ? draft.choices : []
  const choices =
    aiChoices.length === tpl.choices.length
      ? tpl.choices.map((_, i) => ({
          label: String(aiChoices[i]?.label ?? '').trim(),
          note: String(aiChoices[i]?.note ?? '').trim(),
        }))
      : tpl.choices
  return {
    poetic: (draft.poetic || tpl.poetic).trim(),
    slides: [
      {
        title: (slide?.title || tpl.slides[0].title).trim(),
        bullets: bullets.length > 0 ? bullets : tpl.slides[0].bullets,
        narration: (slide?.narration || tpl.slides[0].narration).trim(),
      },
    ],
    choices,
    endingTitle: (draft.endingTitle || tpl.endingTitle).trim(),
  }
}

/**
 * 把 AI 给的结构对齐回 `names` 顺序：名字对不上、重复、或有节点没被覆盖就整段作废
 * （宁可保留作者原来的结构，也不要让缺项被当成「这个节点没有去向」而误判成结局）。
 */
function alignStructure(raw: unknown, names: string[]): WrittenStoryStructure | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { entry, nodes } = raw as { entry?: unknown; nodes?: unknown }
  if (!Array.isArray(nodes)) return undefined
  const valid = new Set(names)
  const byName = new Map<string, string[]>()
  for (const item of nodes) {
    const { name, to } = (item || {}) as { name?: unknown; to?: unknown }
    const key = typeof name === 'string' ? name.trim() : ''
    if (!valid.has(key) || byName.has(key)) continue
    const targets = Array.isArray(to)
      ? [...new Set(to.map((t) => String(t).trim()).filter((t) => valid.has(t) && t !== key))]
      : []
    byName.set(key, targets)
  }
  if (byName.size !== names.length) return undefined
  const entryName = typeof entry === 'string' ? entry.trim() : ''
  return {
    entry: byName.has(entryName) ? entryName : undefined,
    nodes: names.map((name) => ({ name, to: byName.get(name) as string[] })),
  }
}

/* ============ 打卡模式：简介 → 逐个节点，两段式 ============
   与故事模式同一个道理：一次请求写全部，节点一多就会撞 max_tokens 被截断；
   拆开之后每段一完成就落盘、进度是真的，某一段失败也不会牵连别的节点。 */

/** 打卡侧两段共用的上下文说明 */
function checkinBrief(input: CheckinFields): string {
  return `景点名称：${input.name}
城市/区域：${input.city || '（未知）'}
【高德地图地点信息】${input.amapContext || '（暂无）'}`
}

/** 节点清单；传了 `mark` 就给那一站打个「就是这一段」的标记 */
function checkinNodeList(input: CheckinFields, mark?: number): string {
  return input.spots
    .map((s, i) => `${i + 1}. ${s.name}${i === mark ? ' ← 就是这一站' : ''}`)
    .join('\n')
}

/** 打卡模式 ①：景点简介给列表与封面用 */
function checkinIntroSystemPrompt(): string {
  return `你是文旅导览内容策划。请为给定的景点写一段简介，用于前台列表与封面。
- 不要输出坐标、地址或地图检索词
- 不要用「第几站」这类导览用语
只输出一个 JSON 对象，不要其它说明。格式：
{
  "description": "景点简介，约80～120字"
}`
}

/** 打卡模式 ②：只写一个节点的讲解 */
function checkinNodeSystemPrompt(count: number, index: number): string {
  return `你是文旅导览内容策划。现在只写**第 ${index + 1} / ${count} 个导览节点**这一段讲解，别的节点不要写。
- 节点名称与顺序都已经确定，不要改名、不要替别的节点写
- 不要输出坐标、地址或地图检索词
只输出一个 JSON 对象，不要其它说明。格式：
{
  "poetic": "简短诗意副标题",
  "slides": [
    {
      "title": "讲解标题",
      "bullets": ["要点1", "要点2", "要点3"],
      "narration": "约60～100字口语讲解稿，可融入地点类型/地址信息"
    }
  ]
}`
}

/* ============ 故事模式：结构 → 开场 → 逐个节点，三段式 ============
   每段各发一次请求。拆开的理由有两个：一是每段一完成就能立刻落盘、界面上的进度是真的；
   二是「上一站刚讲完什么」能真的喂进下一段的 prompt，情节前后相接不再只靠模型自己记得。 */

/** 三段共用的上下文说明 */
function storyBrief(input: StoryFields): string {
  return `景点名称：${input.name}
城市/区域：${input.city || '（未知）'}
【创作方向（作者意图，务必贯彻）】${input.direction || '（没写，按这个景点的气质自己发挥）'}
【高德地图地点信息】${input.amapContext || '（暂无）'}`
}

function nodeLine(node: { name: string; to: string[]; ending: boolean }, i: number): string {
  if (node.to.length === 0) return `${i + 1}. ${node.name}（结局 · 无去向）`
  return `${i + 1}. ${node.name} → 去向：${node.to.join('、')}`
}

/** ① 结构段：只设计走向，不写任何文案 */
function storyStructureSystemPrompt(count: number): string {
  return `你是文旅互动故事的策划。这是一个按地图实景分岔的行走故事，请重新设计它的走向。
- 节点（共 ${count} 个）与坐标都已经定好，不要增加、删除、合并、替换或改名
只输出一个 JSON 对象，不要其它说明。格式：
{
  "structure": {
    "entry": "入口节点名",
    "nodes": [{ "name": "节点名", "to": ["去向节点名"] }]
  }
}
要求：
- nodes 覆盖全部 ${count} 个节点，name 与列表严格一致
- entry 填入口节点名；从入口沿 to 必须能走到每一个节点，不许留下走不到的一段
- 结局就是 to 为空数组的节点，留 1～3 个；其余节点的 to 至少写一个
- 同一个节点的 to 里不要重复、不要指向自己
- 有起承转合：分叉出现在该让玩家做选择的地方，别为了分叉而分叉`
}

/** ② 开场段：只写故事名与前情提要 */
function storyIntroSystemPrompt(): string {
  return `你是文旅互动故事的编剧。这是一个按地图实景分岔的行走故事，请写好它的开场：故事名与前情提要。
只输出一个 JSON 对象，不要其它说明。格式：
{
  "title": "故事名，6～12字",
  "description": "前情提要，约80～120字：交代「你」是谁、为什么来到这里、这一程要做什么；像故事的开场，不要写景点介绍"
}
要求：
- title 要像故事的名字而不是景点介绍，要有悬念或意象，别用「××导览」「××之旅」这种说明书口气
- 全篇第二人称「你」
- 有「创作方向」就严格照着写（主线、语气、意象都听它的）；没写就顺着这个景点的气质自己定一条主线`
}

/** ③ 节点段：只写一个节点的那一段 */
function storyNodeSystemPrompt(count: number, index: number): string {
  return `你是文旅互动故事的编剧。这是一个按地图实景分岔的行走故事，现在只写**第 ${index + 1} / ${count} 个节点**这一段，别的节点不要写。
只输出一个 JSON 对象，不要其它说明。格式：
{
  "poetic": "简短诗意副标题",
  "slides": [
    {
      "title": "这一段情节的标题",
      "bullets": ["要点1", "要点2", "要点3"],
      "narration": "约60～100字口语讲述稿，接着上一段往下讲"
    }
  ],
  "choices": [{ "label": "玩家点的那句话", "note": "约 80 米 · 5 分钟" }],
  "endingTitle": "结局 · ×××（不是结局就留空字符串）"
}
要求：
- 全篇第二人称「你」；情节要接得住上一站留下的悬念
- choices 的数量与顺序必须与这个节点列出的「去向」完全一致；这个节点是「结局 · 无去向」时 choices 给空数组
- label 是玩家看到并点下去的那句话（如「沿石阶继续往上」「绕到湖边看看」），6～14 字，别用「前往」「下一步」这类机械说法，要带上一点悬念或情绪
- note 是一行小字（距离 / 时长 / 悬念提示），拿不准就给空字符串
- 这个节点是「结局 · 无去向」时：endingTitle 写「结局 · ×××」，情节要有落地感、别留新钩子；其余节点 endingTitle 留空字符串`
}

/** 一次模型请求：system + user 进，解析好的 JSON 出；失败抛错，由各入口自己回落模板 */
async function callModel(
  system: string,
  user: string,
  key?: string,
): Promise<{ parsed: Record<string, unknown>; truncated: boolean }> {
  const baseUrl = import.meta.env.VITE_DEEPSEEK_BASE_URL
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY
  const model = import.meta.env.VITE_DEEPSEEK_MODEL || 'deepseek-chat'

  if (!baseUrl || !apiKey) throw new Error('未配置 VITE_DEEPSEEK_BASE_URL / VITE_DEEPSEEK_API_KEY')

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
  try {
    return { parsed: extractJson(content, key), truncated }
  } catch (e) {
    throw truncated
      ? new Error('AI 输出被截断（max_tokens 不足），未取到完整 JSON')
      : e
  }
}

export type CheckinIntroResult = {
  /** AI 没给就留空，由人写 */
  description?: string
  source: 'ai' | 'mock'
  reason?: string
}

export type CheckinNodeResult = {
  content: WrittenSpotContent
  source: 'ai' | 'mock'
  reason?: string
}

/** ① 简介段：只要景点简介（只产出文案，不产出坐标、不改名称） */
export async function fillCheckinIntro(input: CheckinFields): Promise<CheckinIntroResult> {
  const user = `${checkinBrief(input)}

【本景点的节点（按顺序）】
${checkinNodeList(input)}

请写好这个景点的简介。`

  try {
    const { parsed } = await callModel(checkinIntroSystemPrompt(), user)
    const description = typeof parsed.description === 'string' ? parsed.description.trim() : ''
    if (!description) throw new Error('AI JSON 里没有简介')
    return { description, source: 'ai' }
  } catch (e) {
    const reason = e instanceof Error ? e.message : '未知错误'
    console.warn('[aiDraft] 简介段回落:', reason, e)
    return { source: 'mock', reason }
  }
}

/** ② 节点段：只写**一个**节点的讲解 */
export async function fillCheckinNode(
  input: CheckinFields,
  index: number,
): Promise<CheckinNodeResult> {
  const name = input.spots[index]?.name || ''
  const fallback = (reason: string): CheckinNodeResult => ({
    content: templateContent(input, index, name, undefined, false),
    source: 'mock',
    reason,
  })
  if (!name) return fallback('节点不存在')

  const user = `${checkinBrief(input)}

【景点简介（已经定好，这一段讲解要跟它对得上）】
${input.description || '（还没写）'}

【本景点的全部节点（按顺序，供你判断这一站的位置）】
${checkinNodeList(input, index)}

【这一站的节点】${name}

请只输出这一个节点的 JSON。`

  try {
    const { parsed, truncated } = await callModel(
      checkinNodeSystemPrompt(input.spots.length, index),
      user,
      'slides',
    )
    if (truncated) console.warn('[aiDraft] 节点段输出被截断，已用完整部分')
    return {
      content: toContent(parsed as AiContentDraft, input, index, name, undefined, false),
      source: 'ai',
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : '未知错误'
    console.warn('[aiDraft] 节点段回落:', reason, e)
    return fallback(reason)
  }
}

export type StoryStructureResult = {
  /** 只有结构能完整对上节点时才在；否则调用方保留原结构 */
  structure?: WrittenStoryStructure
  source: 'ai' | 'mock'
  reason?: string
}

export type StoryIntroResult = {
  storyTitle?: string
  description?: string
  source: 'ai' | 'mock'
  reason?: string
}

export type StoryNodeResult = {
  content: WrittenSpotContent
  source: 'ai' | 'mock'
  reason?: string
}

/** ① 结构段：要一份新走向（入口 + 每节点 to），节点与坐标始终不动 */
export async function fillStoryStructure(input: StoryFields): Promise<StoryStructureResult> {
  const names = input.spots.map((s) => s.name)
  const fail = (reason: string): StoryStructureResult => ({ source: 'mock', reason })
  if (names.length === 0) return fail('没有节点，无法重排结构')

  const user = `${storyBrief(input)}

【现有节点与去向（共 ${names.length} 个，只是现状，你可以重新设计）】
${input.nodes.map(nodeLine).join('\n')}

请重新设计走向，并按格式输出 structure。`

  try {
    // 截断的结构宁可整段作废：缺项会被当成「这个节点没有去向」而误判成结局
    const { parsed, truncated } = await callModel(storyStructureSystemPrompt(names.length), user)
    if (truncated) throw new Error('AI 输出被截断，结构未取全')
    const structure = alignStructure(parsed.structure, names)
    if (!structure) throw new Error('AI 没给出能对上节点的结构')
    return { structure, source: 'ai' }
  } catch (e) {
    const reason = e instanceof Error ? e.message : '未知错误'
    console.warn('[aiDraft] 结构段回落:', reason, e)
    return fail(reason)
  }
}

/** ② 开场段：要故事名与前情提要 */
export async function fillStoryIntro(input: StoryFields): Promise<StoryIntroResult> {
  const names = input.spots.map((s) => s.name)
  const fail = (reason: string): StoryIntroResult => ({ source: 'mock', reason })

  const user = `${storyBrief(input)}

【故事的节点顺序（共 ${names.length} 个）】
${input.nodes.map(nodeLine).join('\n')}

请写好这个故事的故事名与前情提要。`

  try {
    const { parsed } = await callModel(storyIntroSystemPrompt(), user)
    const storyTitle = typeof parsed.title === 'string' ? parsed.title.trim() : ''
    const description = typeof parsed.description === 'string' ? parsed.description.trim() : ''
    if (!storyTitle && !description) throw new Error('AI JSON 里没有故事名与前情提要')
    return {
      storyTitle: storyTitle || undefined,
      description: description || undefined,
      source: 'ai',
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : '未知错误'
    console.warn('[aiDraft] 开场段回落:', reason, e)
    return fail(reason)
  }
}

/**
 * ③ 节点段：只写**一个**节点的情节 / 选项文案 / 结局标题。
 * `previous` 是上一站已经定稿的讲述稿 —— 把它喂进去，「情节前后相接」就不再只靠模型自己记得。
 */
export async function fillStoryNode(
  input: StoryFields,
  index: number,
  previous?: string,
): Promise<StoryNodeResult> {
  const node = input.nodes[index]
  const name = input.spots[index]?.name || node?.name || ''
  const fallback = (reason: string): StoryNodeResult => ({
    content: templateContent(input, index, name, node, true),
    source: 'mock',
    reason,
  })
  if (!node) return fallback('节点不存在')

  const toLine = node.to.length === 0 ? '（结局 · 无去向）' : `去向：${node.to.join('、')}`
  const user = `${storyBrief(input)}

【前情提要（已经定好，这一段要顺着它往下讲）】
${input.description || '（还没写）'}

【故事的全部节点（按顺序，供你判断这一段在故事的哪一环）】
${input.nodes.map((n, i) => `${i + 1}. ${n.name}${i === index ? ' ← 就是这一段' : ''}`).join('\n')}

【这一段的节点】${name}　${toLine}
【上一站刚讲完】${previous ? previous : '（这一站就是入口，前面没有别的站）'}

请只输出这一个节点的 JSON。`

  try {
    const { parsed, truncated } = await callModel(
      storyNodeSystemPrompt(input.nodes.length, index),
      user,
      'slides',
    )
    if (truncated) console.warn('[aiDraft] 节点段输出被截断，已用完整部分')
    return { content: toContent(parsed as AiContentDraft, input, index, name, node, true), source: 'ai' }
  } catch (e) {
    const reason = e instanceof Error ? e.message : '未知错误'
    console.warn('[aiDraft] 节点段回落:', reason, e)
    return fallback(reason)
  }
}
