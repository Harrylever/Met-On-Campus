import { adminData } from '~/lib/admin-api'
import { ListManager } from '../lists/ListManager'

export default async function Spots() {
  const { items, campuses } = await adminData('/admin/spots')
  return (
    <>
      <div><h1 className="text-2xl font-bold">Campus spots</h1><p className="text-sm text-ink-2">Public places students can pick as a usual spot and suggest for meetups. Only public places belong here; students can never suggest a private address.</p></div>
      <ListManager kind="spots" noun="spot" items={items} campuses={campuses} usedLabel="Profiles" />
    </>
  )
}
