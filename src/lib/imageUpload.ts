import type { DraftAttraction } from '../types/attraction'

function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

/** 把上传的图挂到某个节点上；封面正好是这张图（或本来没封面）时一并换掉 */
export async function attachSpotImage(
  draft: DraftAttraction,
  spotId: string,
  file: File,
): Promise<DraftAttraction> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
  const dataUrl = await readImageFile(file)
  const target = draft.spots.find((s) => s.id === spotId)
  const spots = draft.spots.map((s) =>
    s.id === spotId ? { ...s, image: dataUrl, imageCredit: file.name } : s,
  )
  return {
    ...draft,
    spots,
    coverImage: draft.coverImage === target?.image || !draft.coverImage ? dataUrl : draft.coverImage,
  }
}

/** 上传游客头像（导览页地图上那枚标记）；不加这个字段就是内置吉祥物 */
export async function attachVisitorAvatar(
  draft: DraftAttraction,
  file: File,
): Promise<DraftAttraction> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
  return { ...draft, visitorAvatar: await readImageFile(file) }
}
