/**
 * 站点根路径解析。
 * 发布包与草稿里存的 `/spots/...` 是「站点根路径」逻辑值，内容创作端写的就是它。
 * 本地 dev 时站点就在根上，原样返回；静态托管到 `/site/<id>/` 这类前缀下时按 BASE_URL 展开。
 */
const BASE = import.meta.env.BASE_URL || '/'

export function siteUrl(path: string): string {
  if (!path) return ''
  if (path.startsWith('data:') || /^https?:\/\//i.test(path)) return path
  if (BASE === '/') return path
  return `${BASE.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}
