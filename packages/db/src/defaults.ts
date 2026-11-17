// Starting lists. The migration that creates the tables inserts the same values, so a fresh database and an existing
// one both begin here; staff change them from the platform afterwards.
export const DEFAULT_DEPARTMENTS = ['Cyber Security', 'Computer Science', 'Information Technology', 'Electrical Engineering'] as const
export const DEFAULT_SPOTS = ['University Library', 'Senate Building Lounge', 'Faculty Quad', 'Student Union Cafeteria', 'ICT Centre', 'School Field'] as const
