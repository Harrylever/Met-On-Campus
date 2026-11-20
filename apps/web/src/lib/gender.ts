export type Gender = 'male' | 'female'

/** The words behind an icon (screen readers and tooltips). Null when not set, so nothing is drawn. */
export function genderLabel(g: Gender | null | undefined): string | null {
  return g === 'male' ? 'Male' : g === 'female' ? 'Female' : null
}
