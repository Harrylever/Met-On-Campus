import { handleApplication } from '~/lib/apply'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handleApplication(req)
}
