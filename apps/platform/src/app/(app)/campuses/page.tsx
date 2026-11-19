import { adminData } from '~/lib/admin-api'
import { CampusManager } from './CampusManager'

type Data = {
  campuses: { slug: string; name: string; open: boolean; emailDomains: string[]; students: number; departments: number; spots: number }[]
  asked: { slug: string; attempts: number; lastAt: string }[]
}

export default async function Campuses() {
  const { campuses, asked } = await adminData<Data>('/admin/campuses')
  return (
    <>
      <div><h1 className="text-2xl font-bold">Campuses</h1><p className="text-sm text-ink-2">The universities students can sign up from. Set the student email domain so only real student addresses can create an account; staff and alumni addresses are turned away.</p></div>
      <CampusManager campuses={campuses} asked={asked} />
    </>
  )
}
