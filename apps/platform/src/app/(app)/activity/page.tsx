import { adminData } from '~/lib/admin-api'
import { ActivityFeed } from './ActivityFeed'

export default async function Activity() {
  const { events } = await adminData('/admin/activity')
  return (
    <>
      <div><h1 className="text-2xl font-bold">Live activity</h1><p className="text-sm text-ink-2">Signups, new rooms, reports and moderation. No message content, no email addresses.</p></div>
      <ActivityFeed initial={events} />
    </>
  )
}
