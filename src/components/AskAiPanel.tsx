import { useState } from 'react'
import { HelpCircle, MessageCircle, Send } from 'lucide-react'
import { AI_MODEL, aiEndpoint } from '../lib/aiConfig'

/**
 * 故事页的"线索"上下文：问答要能答「我该怎么走」就得知道游客站在哪、能去哪。
 * 只喂已按"不回头"过滤过的去向，字面就是选项按钮上的字。
 */
export type AskClue = {
  /** 现在站在哪个节点 */
  here: string
  /** 当前节点的讲解要点，给模型当上下文 */
  detail?: string
  /** 下一步能去哪（`选项按钮上的字（约 N 米）`） */
  choices: string[]
  /** 这一程已走过 / 一共几个节点 */
  visited: number
  total: number
}

function buildSystemPrompt(name: string, clue?: AskClue) {
  const base = `你是${name}的AI导游。回答要简洁、口语化，控制在150字以内。`
  if (!clue) {
    return `${base}只能回答与该景点历史、建筑、文化相关的问题。如果问题无关，请礼貌拒绝。`
  }
  const here = clue.detail ? `「${clue.here}」（${clue.detail}）` : `「${clue.here}」`
  const next =
    clue.choices.length > 0
      ? `从这里可以走向：${clue.choices.join('、')}。`
      : '这里没有别的去向了，这一程到此收尾。'
  return `${base}游客正在按故事线游览：全程 ${clue.total} 个节点，已走过 ${clue.visited} 个，现在站在 ${here}。${next}问到"我该怎么走""下一步去哪"时，就照上面写明的去向给一句建议并说个理由，不要编造不存在的节点或出口；历史、建筑、文化也可以聊。跟这次游览和该景点无关的问题礼貌拒绝。`
}

const MOCK_ANSWERS: Record<string, string> = {
  豫园: '豫园始建于明代嘉靖、万历年间，是上海著名的江南古典园林，至今已有四百余年历史。',
  门票: '豫园需购票入园，可在官方渠道或现场购买，建议提前查询当日开放时间。',
  建筑: '豫园以亭台楼阁、假山池沼见长，玉玲珑、大假山、九曲桥都是标志性景观。',
  历史: '豫园原为四川布政使潘允端为父亲安度晚年所建，后历经战火与修复，成为上海城市名片。',
}

/** 右上角「问线索」按钮 + 展开的线索卡（故事页专用；打卡页是 TourPage 里那份「问 AI」，两处提示词各管各的） */
export function AskAiPanel({ name, clue }: { name: string; clue?: AskClue }) {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [asking, setAsking] = useState(false)

  const ask = async () => {
    if (!question.trim()) return
    setAsking(true)
    setAnswer('')

    try {
      const { url, headers } = aiEndpoint()
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            { role: 'system', content: buildSystemPrompt(name || '景点', clue) },
            { role: 'user', content: question.trim() },
          ],
          stream: false,
          max_tokens: 512,
        }),
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = await res.json()
      const text = data.choices?.[0]?.message?.content?.trim()
      setAnswer(text || 'AI 没有返回内容')
    } catch {
      const q = question.trim()
      const hit = Object.keys(MOCK_ANSWERS).find((k) => q.includes(k))
      setAnswer(
        hit
          ? MOCK_ANSWERS[hit]
          : clue && clue.choices.length > 0
            ? `当前未接入 API，按线索看：从这里可以往${clue.choices.join('、')}走。`
            : `当前未接入 API，我先用本地知识回答：${name || '这里'}值得慢慢逛。`,
      )
    } finally {
      setAsking(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer inline-flex items-center gap-1.5 rounded-full border border-black/5 bg-white/95 px-3.5 py-2 text-sm shadow-sm backdrop-blur-md hover:bg-[#f9fafb]"
      >
        <MessageCircle size={15} className="text-[#3b82f6]" />
        {open ? '收起问答' : '问线索'}
      </button>

      {open && (
        <div className="fixed right-3 top-16 z-40 w-[min(92vw,360px)] rounded-2xl border border-black/5 bg-white/95 p-4 shadow-lg backdrop-blur-md">
          <div className="mb-3 flex items-center gap-2 text-[#111827]">
            <HelpCircle size={15} className="text-[#6b7280]" />
            <span className="text-sm font-medium">询问线索</span>
          </div>
          <div className="flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void ask()}
              placeholder="例如：我该怎么走？"
              className="flex-1 rounded-xl border border-black/8 bg-[#f9fafb] px-3 py-2 text-sm outline-none focus:border-[#3b82f6]/50 focus:bg-white"
            />
            <button
              type="button"
              onClick={() => void ask()}
              disabled={asking || !question.trim()}
              className="cursor-pointer rounded-xl bg-[#3b82f6] px-3 py-2 text-white hover:bg-[#2563eb] disabled:opacity-45"
            >
              {asking ? (
                <span className="block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </div>
          {answer && (
            <div className="mt-3 rounded-xl border border-black/5 bg-[#f9fafb] p-3 text-sm leading-relaxed text-[#374151]">
              {answer}
            </div>
          )}
        </div>
      )}
    </>
  )
}
