import { and, asc, eq } from "drizzle-orm"
import { campusSpots, departments } from "@moc/db"
import { db } from "./context"

// Ready-made choices for "usually free". The profile stores the chosen ones (plus an optional note) as plain text.
export const FREE_TIME_PRESETS = [
  "Weekday mornings",
  "Weekday afternoons",
  "Weekday evenings",
  "Lunch hours",
  "After lectures",
  "Weekend mornings",
  "Weekend afternoons",
  "Weekend evenings",
] as const

type ListTable = typeof departments | typeof campusSpots

/**
 * Names a student on `university` can pick: that campus's own active entries, in staff's sort order, then by name. Each campus
 * has its own list; the entries with no campus are only the template a new campus is copied from, and students never see them.
 */
async function activeNames(table: ListTable, university: string): Promise<string[]> {
  const rows = await db
    .select({ name: table.name })
    .from(table)
    .where(and(eq(table.active, true), eq(table.university, university)))
    .orderBy(asc(table.sortOrder), asc(table.name))
  const seen = new Set<string>()
  return rows
    .map((r) => r.name)
    .filter((n) => (seen.has(n.toLowerCase()) ? false : (seen.add(n.toLowerCase()), true)))
}

export const departmentsFor = (university: string) => activeNames(departments, university)
export const spotsFor = (university: string) => activeNames(campusSpots, university)

// Letters, digits and ordinary punctuation only: these names are shown to students and stored as plain text.
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .,'&()\/-]{1,59}$/u
export const validListName = (s: string) => NAME_RE.test(s)

/** Tidy a name from a form: trim and collapse runs of whitespace. */
export const tidy = (s: string) => s.trim().replace(/\s+/g, " ")

/** The list's own spelling of `name` (case-insensitive match), or undefined if it is not in the list. */
export const canonical = (list: string[], name: string) => list.find((x) => x.toLowerCase() === tidy(name).toLowerCase())

/** What other students see as someone's name: a first name or nickname. Letters, spaces and . ' - only, so a matric number (with digits) can never be the display name. */
export const validPersonName = (s: string) => /^\p{L}[\p{L} .'’-]{1,39}$/u.test(s)
