import { qrPng } from '~/lib/qr'

export const dynamic = 'force-static'

export async function GET() {
  return new Response(new Uint8Array(await qrPng()), {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' },
  })
}
