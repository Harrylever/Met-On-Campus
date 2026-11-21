/**
 * Where an online room's call stands at `now`. A cancelled room counts as ended: there is nothing left to join.
 * Live from the start time up to (not including) the end time, matching the server's join check.
 */
export function joinState(room: { startsAt: string; endsAt: string; cancelled: boolean }, now: Date): 'upcoming' | 'live' | 'ended' {
  if (room.cancelled) return 'ended'
  const t = now.getTime()
  if (t >= new Date(room.endsAt).getTime()) return 'ended'
  if (t < new Date(room.startsAt).getTime()) return 'upcoming'
  return 'live'
}

/** The people in the call (by user id, which is their call identity) whom you have blocked. */
export function blockedAmong(participantIds: string[], blockedIds: Set<string>): string[] {
  return participantIds.filter((id) => blockedIds.has(id))
}

/**
 * The end time to hang up at: the call's room as the rooms list last saw it (so a host extending a live room moves the
 * end), or the copy taken at join if the list does not have it.
 */
export function latestEndsAt(rooms: { id: string; endsAt: string | Date }[] | undefined, callRoomId: string, fallback: string): string {
  const row = rooms?.find((r) => r.id === callRoomId)
  return row ? new Date(row.endsAt).toISOString() : fallback
}
