// Mirrors the API rule (apps/api/src/lists.ts validPersonName): a first name or nickname, letters only. The server decides;
// this just lets the form say so before sending.
export const tidyName = (s: string) => s.trim().replace(/\s+/g, ' ')
export const validPersonName = (s: string) => /^\p{L}[\p{L} .'’-]{1,39}$/u.test(tidyName(s))
// Accounts made before we asked for a name were named from the email address, which carries the matric number.
export const looksLikeMatric = (name: string) => /\d/.test(name)
