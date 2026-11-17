// A student with no department yet (their request is pending, or they have not chosen) is stored as "Unspecified".
// That is an internal placeholder: show people something readable instead.
export const NO_DEPARTMENT = 'Unspecified'
export const deptLabel = (d: string) => (d === NO_DEPARTMENT ? 'Department pending' : d)
