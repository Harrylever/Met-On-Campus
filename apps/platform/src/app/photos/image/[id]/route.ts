import { adminImage } from '~/lib/admin-api'

// Staff-only picture proxy: the request must carry a staff session, and the API checks it again.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 })
  return adminImage(id)
}
