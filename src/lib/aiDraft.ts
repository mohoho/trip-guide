import type { Slide } from './tourPackage'

/** 待写内容的节点：只给名称，坐标、顺序、数量都已在阶段二定好 */
export type FillContentInput = {
  name: string
  description: string
  city?: string
  amapContext?: string
  spots: Array<{ name: string }>
}

export type FillContentResult = {
  /** 与 input.spots 按 index 一一对应 */
  contents: Array<{ poetic: string; slides: Slide[] }>
  /** 景点简介；AI 没给就留空由人写（阶段一已不再收集简介） */
  description?: string
  /** 'ai' = 真实模型返回；'mock' = 本地兜底模板 */
  source: 'ai' | 'mock'
  /** source 为 'mock'、或只写回了一部分时的原因，便于在界面上明示 */
  reason?: string
}

type AiContentDraft = {
  poetic?: string
  slides?: Array<{
    title?: string
    bullets?: string[]
    narration?: string
  }>
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
 * 从模型输出里抠出 JSON，并确认顶层 key 是个非空数组。
 * 先整体解析；失败说明输出被 max_tokens 截断，则从后往前在每个 `}` 处切一刀、
 * 补齐括号后重试，取第一个能解析出 key 的结果（把已生成完的部分救回来）。
 */
function extractJson(text: string, key: string): Record<string, unknown> {
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
      if (Array.isArray(parsed[key]) && parsed[key].length > 0) return parsed
    } catch {
      // 这一刀不行，继续往前切
    }
  }

  throw new Error('AI 返回的 JSON 无法解析（可能被截断）')
}

/** 单个节点的兜底内容（未接通 AI、或某一段缺失时用） */
function templateContent(
  input: FillContentInput,
  index: number,
  nodeName: string,
): { poetic: string; slides: Slide[] } {
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
        narration: `欢迎来到${input.name}。我们现在来到${nodeName}，请稍作停留，感受这里的气息。`,
      },
    ],
  }
}

/** AI 的一段内容 → 节点内容；缺失的字段逐项回落模板 */
function toContent(
  draft: AiContentDraft | undefined,
  input: FillContentInput,
  index: number,
  nodeName: string,
): { poetic: string; slides: Slide[] } {
  const tpl = templateContent(input, index, nodeName)
  if (!draft) return tpl
  const slide = draft.slides?.[0]
  const bullets = Array.isArray(slide?.bullets)
    ? slide.bullets.map((b) => String(b).trim()).filter(Boolean).slice(0, 5)
    : []
  return {
    poetic: (draft.poetic || tpl.poetic).trim(),
    slides: [
      {
        title: (slide?.title || tpl.slides[0].title).trim(),
        bullets: bullets.length > 0 ? bullets : tpl.slides[0].bullets,
        narration: (slide?.narration || tpl.slides[0].narration).trim(),
      },
    ],
  }
}

/**
 * 为**已定好**的节点逐个写讲解内容 —— 只产出文案，不产出坐标、不改名称，
 * 数量与顺序严格按传入的 spots 一一对应。失败回落本地模板。
 */
export async function fillSpotContent(input: FillContentInput): Promise<FillContentResult> {
  const names = input.spots.map((s) => s.name)
  const mock = (reason: string): FillContentResult => ({
    contents: names.map((n, i) => templateContent(input, i, n)),
    source: 'mock',
    reason,
  })

  if (names.length === 0) return mock('没有节点可写讲解')

  const baseUrl = import.meta.env.VITE_DEEPSEEK_BASE_URL
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY
  const model = import.meta.env.VITE_DEEPSEEK_MODEL || 'deepseek-chat'

  if (!baseUrl || !apiKey) {
    return mock('未配置 VITE_DEEPSEEK_BASE_URL / VITE_DEEPSEEK_API_KEY')
  }

  const system = `你是文旅导览内容策划。请为给定的 ${names.length} 个导览节点各写一段讲解，并顺手写好景点简介。
节点名称、数量与顺序都已经确定，必须与给定列表严格一一对应：
- 不要增加、删除、合并、替换或改名任何节点
- 不要输出坐标、地址或地图检索词
只输出一个 JSON 对象，不要其它说明。格式：
{
  "description": "景点简介，约80～120字，用于列表与封面；不要用「第几站」这类导览用语",
  "contents": [
    {
      "poetic": "简短诗意副标题",
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

  const user = `景点名称：${input.name}
城市/区域：${input.city || '（未知）'}
简介：${input.description || '（无）'}

【高德地图地点信息】
${input.amapContext || '（暂无）'}

【本次要写讲解的节点（共 ${names.length} 个，按此顺序各输出 1 段）】
${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}

请按同一顺序输出与节点数量相同的 contents 数组。`

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

    let parsed: { description?: unknown; contents?: AiContentDraft[] }
    try {
      parsed = extractJson(content, 'contents') as { description?: unknown; contents?: AiContentDraft[] }
    } catch (e) {
      throw truncated
        ? new Error('AI 输出被截断（max_tokens 不足），未取到完整 JSON')
        : e
    }
    const drafts = Array.isArray(parsed.contents) ? parsed.contents : []
    if (drafts.length === 0) throw new Error('AI JSON 无 contents')
    if (truncated) console.warn('[aiDraft] 输出被截断，已用完整部分解析出内容')

    return {
      contents: names.map((n, i) => toContent(drafts[i], input, i, n)),
      description:
        typeof parsed.description === 'string' ? parsed.description.trim() : undefined,
      source: 'ai',
      reason:
        drafts.length < names.length
          ? `AI 只返回了 ${drafts.length}/${names.length} 段，其余用模板补齐`
          : undefined,
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : '未知错误'
    console.warn('[aiDraft] fallback mock:', reason, e)
    return mock(reason)
  }
}
