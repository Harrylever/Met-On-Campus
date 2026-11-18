// What earns points. One place, so the app, the staff view and the tests all read the same rules.
// Romance never earns points: a ranking or a streak built on who connects with whom would turn a private mode into a scoreboard.
// Points have no cash value, and staff can reverse them (see point_events).

export type Kind =
  | 'checkin' | 'streak_3' | 'streak_7' | 'streak_30'
  | 'onboarding' | 'profile_complete' | 'photo_approved'
  | 'connection' | 'first_connection' | 'room_joined' | 'room_hosted' | 'meetup_accepted'
  | 'invite_friend' | 'invited_by_friend'

type Rule = {
  points: number
  label: string      // shown in the activity list
  how: string        // shown in "how points work"
  /** Counts toward the overall daily cap. These are the things a person can do over and over. */
  repeatable?: boolean
  /** At most this many awards of this kind per day. */
  perDay?: number
}

export const DAILY_CAP = 60       // across all repeatable kinds, so nobody can run away with the board
export const INVITES_PER_MONTH = 10
export const INVITE_ACTIVE_DAYS = 3 // a friend counts once they have opened the app on this many days

export const RULES: Record<Kind, Rule> = {
  checkin:           { points: 5,   label: 'Daily check-in',                 how: 'Open the app each day',                              repeatable: true, perDay: 1 },
  streak_3:          { points: 10,  label: '3-day streak',                   how: 'Reach a 3-day streak (once)' },
  streak_7:          { points: 25,  label: '7-day streak',                   how: 'Reach a 7-day streak (once)' },
  streak_30:         { points: 100, label: '30-day streak',                  how: 'Reach a 30-day streak (once)' },
  onboarding:        { points: 20,  label: 'Finished setting up',            how: 'Finish setting up your account (once)' },
  profile_complete:  { points: 15,  label: 'Completed your profile',         how: 'Add a prompt, an about and a tag to a Study or Friends profile (once)' },
  photo_approved:    { points: 20,  label: 'First approved photo',           how: 'Get a Study or Friends photo approved (once)' },
  connection:        { points: 5,   label: 'New connection',                 how: 'Someone accepts your invite, or you accept theirs (Study and Friends)', repeatable: true, perDay: 5 },
  first_connection:  { points: 20,  label: 'First connection bonus',         how: 'Your first connection earns a bonus (once)' },
  room_joined:       { points: 10,  label: 'Joined a room',                  how: 'Get a place in a room', repeatable: true, perDay: 3 },
  room_hosted:       { points: 20,  label: 'Hosted a room that filled up',   how: 'Host a room that gets at least 2 other people' },
  meetup_accepted:   { points: 15,  label: 'Meetup arranged',                how: 'Agree a meetup in a Study or Friends chat', repeatable: true, perDay: 2 },
  invite_friend:     { points: 30,  label: 'A friend you invited joined',    how: `Invite a friend who verifies, sets up and opens the app on ${INVITE_ACTIVE_DAYS} days (up to ${INVITES_PER_MONTH} a month)` },
  invited_by_friend: { points: 30,  label: 'You joined through a friend',    how: `Join through a friend's link, set up and open the app on ${INVITE_ACTIVE_DAYS} days (once)` },
}

export const REPEATABLE = (Object.keys(RULES) as Kind[]).filter((k) => RULES[k].repeatable)
export const STREAK_MILESTONES = [[3, 'streak_3'], [7, 'streak_7'], [30, 'streak_30']] as const
