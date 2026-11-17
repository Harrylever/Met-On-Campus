import { adminData } from '~/lib/admin-api'
import { ListManager } from '../lists/ListManager'
import { RequestsPanel } from './RequestsPanel'

export default async function Departments() {
  const [{ items, campuses }, requests] = await Promise.all([adminData('/admin/departments'), adminData('/admin/department-requests')])
  return (
    <>
      <div><h1 className="text-2xl font-bold">Departments</h1><p className="text-sm text-ink-2">The departments students choose from when they sign up and edit their profile. Add one for every campus, or for a single campus.</p></div>
      <RequestsPanel pending={requests.pending} recent={requests.recent} departments={requests.departments} />
      <ListManager kind="departments" noun="department" items={items} campuses={campuses} usedLabel="Students" />
    </>
  )
}
