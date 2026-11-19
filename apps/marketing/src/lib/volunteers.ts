export type RoleId = 'graphic-designer' | 'video-creator' | 'campus-ambassador'
export type Role = { id: RoleId; title: string; tagline: string; doing: string[]; looking: string[] }

// Eligibility: current FUTMinna students. Students use subdomains such as st.futminna.edu.ng, so any subdomain passes.
export const FUTMINNA_DOMAIN = 'futminna.edu.ng'

export const roles: Role[] = [
  {
    id: 'graphic-designer',
    title: 'Graphic Designer',
    tagline: 'Give Met On Campus its look on campus and online.',
    doing: [
      'Design posters, flyers and banners for campus events',
      'Create graphics for our social media pages',
      'Help keep our colours, type and style consistent everywhere',
    ],
    looking: [
      'A strong eye for layout, colour and typography',
      'Experience with tools like Figma, Photoshop, Illustrator or Canva',
      'A few pieces of past work you can show us',
    ],
  },
  {
    id: 'video-creator',
    title: 'Video Content Creator',
    tagline: 'Tell the Met On Campus story in short, watchable videos.',
    doing: [
      'Shoot and edit short videos for social media',
      'Film highlights from campus events and activations',
      'Come up with video ideas that students will want to share',
    ],
    looking: [
      'Experience shooting and editing video, even on a phone',
      'Familiarity with editing tools like CapCut, Premiere Pro or DaVinci Resolve',
      'Creative ideas and the habit of finishing what you start',
    ],
  },
  {
    id: 'campus-ambassador',
    title: 'Campus Ambassador',
    tagline: 'Be the friendly face of Met On Campus among students.',
    doing: [
      'Talk to students about Met On Campus and answer their questions',
      'Help organise and run events on campus',
      'Work closely with the team and share what students are saying',
    ],
    looking: [
      'Confidence speaking to people one-on-one and in groups',
      'Good organisation, reliability and a warm, approachable manner',
      'Enthusiasm for bringing students together',
    ],
  },
]

/** A role id from user-controlled input (e.g. the ?role= query), or undefined if it is not one of ours. */
export const parseRole = (v: string | null | undefined): RoleId | undefined => roles.find((r) => r.id === v)?.id

export type Application = {
  name: string
  email: string
  department: string
  level: string
  role: RoleId
  experience: string
  why: string
  extra: string
  website: string // honeypot: real people never fill it
}

const limits = { name: 100, email: 254, department: 100, level: 20, experience: 2000, why: 2000, extra: 2000 } as const

export function isFutminnaEmail(email: string) {
  const at = email.lastIndexOf('@')
  if (at < 1) return false
  const domain = email.slice(at + 1).toLowerCase()
  return domain === FUTMINNA_DOMAIN || domain.endsWith(`.${FUTMINNA_DOMAIN}`)
}

export function validateApplication(input: unknown): { ok: true; value: Application } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Something is wrong with that form. Please try again.' }
  const raw = input as Record<string, unknown>
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string).trim() : '')

  if (str('website')) return { ok: false, error: 'spam' }

  const name = str('name'), email = str('email'), department = str('department'), level = str('level')
  const experience = str('experience'), why = str('why'), extra = str('extra')

  const required: [string, string, string][] = [
    [name, 'name', 'your full name'], [email, 'email', 'your email'], [department, 'department', 'your department'],
    [level, 'level', 'your level'], [experience, 'experience', 'your experience'], [why, 'why', 'why you want to volunteer'],
  ]
  for (const [v, , label] of required) if (!v) return { ok: false, error: `Please fill in ${label}.` }

  const values: Record<keyof typeof limits, string> = { name, email, department, level, experience, why, extra }
  for (const k of Object.keys(limits) as (keyof typeof limits)[])
    if (values[k].length > limits[k]) return { ok: false, error: `Please shorten ${k === 'why' ? 'your reason' : `your ${k}`} (up to ${limits[k]} characters).` }

  // Single-line fields end up in the email subject or headers, so they may not contain line breaks.
  for (const v of [name, email, department, level]) if (/[\r\n]/.test(v)) return { ok: false, error: 'Please keep your name, email, department and level to one line.' }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Please enter a valid email address.' }
  if (!isFutminnaEmail(email)) return { ok: false, error: 'Applications are open to current FUTMinna students. Please use your FUTMinna email (it ends in futminna.edu.ng).' }

  const role = roles.find((r) => r.id === raw.role)
  if (!role) return { ok: false, error: 'Please choose a role.' }

  return { ok: true, value: { name, email, department, level, role: role.id, experience, why, extra, website: '' } }
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export function renderApplicationEmail(app: Application): { subject: string; text: string; html: string } {
  const role = roles.find((r) => r.id === app.role)!
  const subject = `Volunteer application: ${role.title} - ${app.name}`.replace(/\s+/g, ' ')
  const fields: [string, string][] = [
    ['Role', role.title], ['Name', app.name], ['Email', app.email], ['Department', app.department], ['Level', app.level],
    [`Experience as a ${role.title}`, app.experience], [`Why they want to volunteer as a ${role.title}`, app.why],
    ['Anything else', app.extra || '(nothing added)'],
  ]
  const text = fields.map(([k, v]) => `${k}:\n${v}`).join('\n\n')
  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">` +
    fields.map(([k, v]) => `<p style="margin:0 0 4px;font-weight:600">${escapeHtml(k)}</p><p style="margin:0 0 16px;white-space:pre-wrap">${escapeHtml(v)}</p>`).join('') +
    `</div>`
  return { subject, text, html }
}
