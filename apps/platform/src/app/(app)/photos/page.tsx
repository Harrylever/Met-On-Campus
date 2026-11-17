import { adminData } from '~/lib/admin-api'
import { PhotoReview, type Photo } from './PhotoReview'

export default async function Photos() {
  const { pending, live } = await adminData<{ pending: Photo[]; live: Photo[] }>('/admin/photos')
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Photos</h1>
        <p className="text-sm text-ink-2">Nothing a student uploads is shown to anyone else until you approve it here. Romance photos are then shown only after a match. Check that it is a clear picture of the student and nothing inappropriate.</p>
      </div>
      <PhotoReview pending={pending} live={live} />
    </>
  )
}
