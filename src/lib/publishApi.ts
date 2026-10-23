const TOKEN_KEY = 'trip-guide:publish-token'
export const PUBLISH_AUTH_EVENT = 'trip-guide:publish-auth'

export function getPublishToken(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}

export function setPublishToken(token: string) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch { throw new Error('浏览器无法保存发布授权，请允许当前站点的会话存储') }
  window.dispatchEvent(new Event(PUBLISH_AUTH_EVENT))
}

export function publishAuthHeaders(token = getPublishToken()): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export type PublishAuthStatus = { ok: true; authRequired: boolean; authenticated: boolean }

export async function checkPublishAccess(token = getPublishToken()): Promise<PublishAuthStatus> {
  const response = await fetch('/__trip_guide/auth', { headers: publishAuthHeaders(token), cache: 'no-store' })
  const data = await response.json().catch(() => null) as PublishAuthStatus | null
  if (!response.ok || !data?.ok) throw new Error('发布服务未连接，请先启动后端服务')
  return data
}

export async function publishRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { ...options, headers: { ...publishAuthHeaders(), ...options.headers } })
  } catch { throw new Error('无法连接发布服务，请检查网络后重试') }
  const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null
  if (response.status === 401) {
    setPublishToken('')
    throw new Error('发布授权已失效，请重新输入发布口令')
  }
  if (!response.ok || !data?.ok) throw new Error(data?.error || `发布服务异常（HTTP ${response.status}）`)
  return data as T
}
