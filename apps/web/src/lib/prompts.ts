import type { Intent } from '~/lib/api'

// Starter prompts for the profile's "Prompt" field: a hint of what a good one looks like, or a shortcut for anyone who
// does not want to write their own. Six per mode, because a study prompt would be wrong on a Romance profile.
// Each is first person, concrete, and well under the field's 160-character limit.
export const PROMPT_SUGGESTIONS: Record<Intent, readonly string[]> = {
  study: [
    'Looking for a partner to go through past questions before exams.',
    'Need two people for a group assignment, ideally someone who likes to start early.',
    'Want a quiet study buddy for the library. No chatting until the break.',
    'Stuck on one course and happy to swap help: you explain yours, I explain mine.',
    'Starting a weekly revision group. Bring a topic you want to go over.',
    'Looking for someone to keep me accountable while I prepare for exams.',
  ],
  friends: [
    'Up for a game of football on the school field. Any position, any skill level.',
    'New here and looking for people to try the different cafeterias with.',
    'Planning a movie night. Bring your favourite movie and a snack.',
    "Looking for people to join a club with, so I don't go alone.",
    'Always up for a game of chess between lectures.',
    'Want a lunch group so I stop eating alone. All departments welcome.',
  ],
  romance: [
    'Someone to gist with after evening lectures.',
    'A cold drink at the cafeteria and an honest conversation.',
    'Looking for someone who laughs easily and loves a long conversation.',
    'Someone who takes their studies seriously and their weekends lightly.',
    'A study date at the library that turns into lunch at the cafeteria.',
    'Someone to share good music with. Afrobeats, highlife, whatever you love.',
  ],
}

/**
 * Hands out suggestions for one mode, a shuffled pass at a time: every prompt appears once before any repeats, and a
 * suggestion is never the same as the text already in the field or the one just shown. Pass `random` to make it testable.
 */
export function createSuggester(intent: Intent, random: () => number = Math.random) {
  const list = PROMPT_SUGGESTIONS[intent]
  let queue: string[] = []
  let last = ''
  const refill = () => {
    queue = [...list]
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[queue[i], queue[j]] = [queue[j]!, queue[i]!]
    }
    if (queue[0] === last) queue.push(queue.shift()!) // do not repeat across the seam between two passes
  }
  return (current = ''): string => {
    if (queue.length === 0) refill()
    let next = queue.shift()!
    if (next === current && queue.length > 0) { queue.push(next); next = queue.shift()! }
    last = next
    return next
  }
}
