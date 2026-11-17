import { ImageResponse } from 'next/og'

export const alt = 'Met On Campus: find your people on campus'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Shared by link previews (WhatsApp, X, iMessage). Static, so it is rendered once at build time.
export default function Image() {
  const ring = (color: string, left: number) => ({ position: 'absolute' as const, top: 0, left, width: 250, height: 250, borderRadius: 999, border: `34px solid ${color}` })
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#FAF9F6', padding: 80, color: '#141413' }}>
        <div style={{ position: 'relative', display: 'flex', width: 530, height: 250 }}>
          <div style={ring('#2563EB', 0)} /><div style={ring('#059669', 140)} /><div style={ring('#E11D48', 280)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -3, lineHeight: 1.02 }}>Find your people on campus.</div>
          <div style={{ marginTop: 20, fontSize: 36, color: '#57534E' }}>Met On Campus: verified students, public places.</div>
        </div>
      </div>
    ),
    size,
  )
}
