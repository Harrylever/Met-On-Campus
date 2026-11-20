import { genderLabel, type Gender } from '~/lib/gender'

/** A small male or female symbol beside a name. Draws nothing when not set. The two shapes differ, so colour never carries the meaning, and the label is read aloud. */
export function GenderIcon({ gender, size = 16 }: { gender?: Gender | null; size?: number }) {
  const label = genderLabel(gender)
  if (!label) return null
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block shrink-0 align-[-2px]">
      <title>{label}</title>
      {gender === 'female'
        ? <><circle cx="12" cy="9" r="5" /><path d="M12 14v8M9 18h6" /></>
        : <><circle cx="10" cy="14" r="5" /><path d="M14 10l6-6M15 4h5v5" /></>}
    </svg>
  )
}
