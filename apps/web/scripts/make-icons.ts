// Regenerates the app icons from public/favicon.svg: `bun run icons`. Run it when the logo changes and commit the PNGs.
import sharp from 'sharp'
import { readFileSync } from 'node:fs'

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8')
const out = (name: string) => new URL(`../public/icons/${name}`, import.meta.url).pathname
const rings = [['#2563EB', 342], ['#059669', 512], ['#E11D48', 682]] as const

// "Any" icons use the logo as drawn (it already has its own rounded tile).
for (const size of [192, 512]) await sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toFile(out(`icon-${size}.png`))
// Apple draws its own rounded corners and dislikes transparency: a full square.
const full = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#FFF1F2"/>${rings.map(([c, x]) => `<circle cx="${x}" cy="512" r="150" fill="none" stroke="${c}" stroke-width="88"/>`).join('')}</svg>`
await sharp(Buffer.from(full), { density: 384 }).resize(180, 180).png().toFile(out('apple-touch-icon.png'))
// Maskable: Android may crop to a circle or squircle, so the logo sits inside the central 80% "safe zone".
const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#FFF1F2"/><g transform="translate(512 512) scale(0.78) translate(-512 -512)">${rings.map(([c, x]) => `<circle cx="${x}" cy="512" r="150" fill="none" stroke="${c}" stroke-width="88"/>`).join('')}</g></svg>`
await sharp(Buffer.from(mask), { density: 384 }).resize(512, 512).png().toFile(out('maskable-512.png'))
// The small status-bar icon on Android notifications must be a white shape on transparent: the three rings.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${rings.map(([, x]) => `<circle cx="${x}" cy="512" r="150" fill="none" stroke="#fff" stroke-width="88"/>`).join('')}</svg>`
await sharp(Buffer.from(badge), { density: 384 }).resize(96, 96).png().toFile(out('badge-96.png'))
console.log('icons written')
