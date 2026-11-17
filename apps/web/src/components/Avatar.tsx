import { useState } from 'react'
import { API_URL } from '~/lib/api'

/** A student's picture from the API, which checks who is asking (the cookie travels with the request). */
export const photoUrl = (id: string) => `${API_URL}/photos/${id}`

/** Circle with the photo, or their initial when they have none (or it cannot be loaded). Decorative: the name is always next to it. */
export function Avatar({ name, photoId, size = 44 }: { name: string; photoId?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false)
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) }
  if (photoId && !failed) {
    return <img src={photoUrl(photoId)} alt="" aria-hidden="true" width={size} height={size} style={style} onError={() => setFailed(true)}
      className="shrink-0 rounded-full border border-(--i-line) bg-(--i-bg) object-cover" />
  }
  return <span aria-hidden="true" style={style} className="flex shrink-0 items-center justify-center rounded-full border border-(--i-line) bg-(--i-bg) font-display font-bold text-(--i-ink)">{name[0]}</span>
}
