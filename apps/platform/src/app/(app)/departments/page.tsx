import { adminData } from '~/lib/admin-api'
import { ListManager } from '../lists/ListManager'

export default async function Departments() {
  const { items, campuses } = await adminData('/admin/departments')
  return (
    <>
      <div><h1 className="text-2xl font-bold">Departments</h1><p className="text-sm text-ink-2">The departments students choose from when they sign up and edit their profile. Add one for every campus, or for a single campus.</p></div>
      <ListManager kind="departments" noun="department" items={items} campuses={campuses} usedLabel="Students" />
    </>
  )
}
