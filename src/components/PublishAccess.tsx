import { useCallback, useEffect, useState } from 'react'
import { KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import { checkPublishAccess, PUBLISH_AUTH_EVENT, setPublishToken, type PublishAuthStatus } from '../lib/publishApi'

/** Reused by the management page and preview, including direct preview links. */
export function PublishAccess({ onChange }: { onChange?: () => void }) {
  const [status, setStatus] = useState<PublishAuthStatus | null>(null)
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const refresh = useCallback(() => {
    void checkPublishAccess().then((value) => { setStatus(value); setError('') })
      .catch((e) => { setStatus(null); setError(e.message) })
  }, [])
  useEffect(() => {
    refresh()
    window.addEventListener(PUBLISH_AUTH_EVENT, refresh)
    return () => window.removeEventListener(PUBLISH_AUTH_EVENT, refresh)
  }, [refresh])

  const authorize = async () => {
    setBusy(true)
    setError('')
    try {
      const next = await checkPublishAccess(token.trim())
      if (!next.authenticated) throw new Error('发布口令不正确')
      setPublishToken(token.trim())
      setStatus(next)
      setToken('')
      setEditing(false)
      onChange?.()
    } catch (e) { setError(e instanceof Error ? e.message : '授权失败') }
    finally { setBusy(false) }
  }
  const needsInput = status?.authRequired && (!status.authenticated || editing)
  return <section aria-label="发布授权" className="rounded-xl border border-[#315442]/15 bg-[#faf9f4] px-4 py-3 text-xs text-[#596052] shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="inline-flex items-center gap-2">
        {status?.authenticated ? <ShieldCheck size={15} /> : <LockKeyhole size={15} />}
        {status ? status.authRequired ? status.authenticated ? '发布已授权' : '输入发布口令后可管理线上内容' : '本地发布服务已连接' : error ? '发布服务未连接' : '正在连接发布服务'}
      </span>
      {status?.authRequired && status.authenticated && !editing && <button type="button"
        className="cursor-pointer underline underline-offset-4"
        onClick={() => { setPublishToken(''); setEditing(true); onChange?.() }}>退出授权</button>}
      {!status && <button type="button" className="cursor-pointer underline" onClick={refresh}>重新连接</button>}
    </div>
    {needsInput && <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void authorize() }}>
      <label className="sr-only" htmlFor="publish-token">发布口令</label>
      <input id="publish-token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)}
        placeholder="输入管理员提供的发布口令" className="min-w-0 flex-1 rounded-lg border border-[#315442]/20 bg-white px-3 py-2 text-sm outline-none focus:border-[#315442]" />
      <button type="submit" disabled={busy || !token.trim()} className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-[#315442] px-4 py-2 text-white disabled:opacity-50"><KeyRound size={13} />{busy ? '验证中…' : '授权'}</button>
      <p className="w-full text-[10px] text-[#72766a]">授权仅在当前标签页会话中保存。</p>
    </form>}
    {error && <p role="alert" className="mt-2 text-red-600">{error}</p>}
  </section>
}
