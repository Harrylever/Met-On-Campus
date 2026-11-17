import { qrSvg } from '~/lib/qr'

export const dynamic = 'force-static'

export async function GET() {
  return new Response(await qrSvg(), {
    headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=86400' },
  })
}
