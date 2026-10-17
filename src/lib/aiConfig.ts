/**
 * 三处 AI 调用共用的端点、鉴权与模型名：
 * 发布端生成（`aiDraft.ts`）、打卡页问答（`TourPage.tsx`）、故事页问答（`AskAiPanel.tsx`）。
 *
 * 端点要求：OpenAI 兼容的 `POST {base}/chat/completions`，且**公网可达**（线上是浏览器直连）。
 * 模型名必须落在端点自报支持的那几个里——配错端点会直接 400，不会回落成"没配 AI"。
 */

/** 缺省值跟着 `VITE_DEEPSEEK_BASE_URL` 那个端点走，换网关时要一起看 */
export const AI_MODEL = import.meta.env.VITE_DEEPSEEK_MODEL || 'deepseek-flash'

/** 端点与鉴权头；没配全就抛错，由各调用入口自己决定回落什么 */
export function aiEndpoint(): { url: string; headers: Record<string, string> } {
  const baseUrl = (import.meta.env.VITE_DEEPSEEK_BASE_URL || '').replace(/\/$/, '')
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY
  if (!baseUrl || !apiKey) throw new Error('未配置 VITE_DEEPSEEK_BASE_URL / VITE_DEEPSEEK_API_KEY')
  return {
    url: `${baseUrl}/chat/completions`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  }
}
