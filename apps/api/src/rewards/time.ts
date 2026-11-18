// Rewards run on Nigerian calendar days. Nigeria is UTC+1 all year (no daylight saving), so a day is a fixed shift of UTC.
const WAT_MS = 3_600_000

/** The Nigerian calendar day of a moment, as 'YYYY-MM-DD'. */
export const watDay = (d: Date = new Date()) => new Date(+d + WAT_MS).toISOString().slice(0, 10)
export const watMonth = (d: Date = new Date()) => watDay(d).slice(0, 7)
/** Whole days from day `a` to day `b` (both 'YYYY-MM-DD'). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
export const addDays = (day: string, n: number) => new Date(Date.parse(day) + n * 86_400_000).toISOString().slice(0, 10)
export const monthStart = (month: string) => `${month}-01`
export const nextMonthStart = (month: string) => { const [y, m] = month.split('-').map(Number) as [number, number]; return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01` }
