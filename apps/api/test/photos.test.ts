import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { adminAudit, profilePhotos, users } from '@moc/db'
import { app } from '../src'
import { db } from '../src/context'
import { store } from '../src/storage'
import { adminCall, adminLogin, call, makeAdmin, makeUser, resetAll, type Intent } from './helpers'

let S: string
const A = (m: string, p: string, body?: unknown) => adminCall(m, p, body, { session: S })

/** A real photo-like JPEG with EXIF (camera/location style metadata) so we can prove it is stripped. */
const jpeg = (w = 900, h = 700) => sharp({ create: { width: w, height: h, channels: 3, background: '#3366cc' } }).withMetadata({ exif: { IFD0: { Copyright: 'secret-camera-tag' } } }).jpeg().toBuffer()

async function upload(u: { token: string }, intent: Intent, file: Blob | Buffer, name = 'me.jpg', type = 'image/jpeg') {
  const form = new FormData()
  form.append('intent', intent)
  form.append('file', new File([file as BlobPart], name, { type }))
  const res = await app.handle(new Request('http://localhost/me/photos', { method: 'POST', headers: { cookie: `moc_session=${u.token}` }, body: form }))
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json }
}
const rows = (userId: string) => db.select().from(profilePhotos).where(eq(profilePhotos.userId, userId))
const mine = async (u: { token: string }) => (await call(u, 'GET', '/me/photos')).json.photos
const fetchImg = (viewer: { token: string } | null, id: string) => call(viewer, 'GET', `/photos/${id}`)
async function approvedPhoto(u: { id: string; token: string }, intent: Intent) {
  expect((await upload(u, intent, await jpeg())).status).toBe(200)
  const id = (await rows(u.id)).find((r) => r.status === 'pending')!.id
  expect((await A('POST', '/admin/photos/resolve', { photoId: id, action: 'approve' })).status).toBe(200)
  return id
}
const discoverFor = async (viewer: { token: string }, intent: Intent, name: string) =>
  (await call(viewer, 'GET', `/discover?intent=${intent}`)).json.cards.find((c: { name: string }) => c.name === name)

beforeEach(async () => { await resetAll(); S = await adminLogin(await makeAdmin()) })

describe('uploading', () => {
  test('needs a sign-in, and the mode must be on', async () => {
    const u = await makeUser('Amina', { modes: ['study'] })
    expect((await call(null, 'GET', '/me/photos')).status).toBe(401)
    expect((await upload(u, 'romance', await jpeg())).status).toBe(403)
  })

  test('a good photo is saved private and waiting; it is re-encoded square WebP with all metadata removed', async () => {
    const u = await makeUser('Amina')
    expect((await upload(u, 'study', await jpeg())).status).toBe(200)
    const [row] = await rows(u.id)
    expect(row).toMatchObject({ status: 'pending', intent: 'study' })
    const bytes = (await store.get(row!.storageKey))!
    const meta = await sharp(bytes).metadata()
    expect(meta).toMatchObject({ format: 'webp', width: 640, height: 640 })
    expect(meta.exif).toBeUndefined()
    expect(Buffer.from(bytes).includes('secret-camera-tag')).toBe(false)
    expect((await mine(u)).study).toMatchObject({ pending: { id: row!.id }, approved: null })
  })

  test('rejects things that are not usable pictures, whatever the browser called them', async () => {
    const u = await makeUser('Amina')
    expect((await upload(u, 'study', Buffer.from('<?php echo 1;'), 'me.jpg', 'image/jpeg')).status).toBe(422)  // not an image at all
    expect((await upload(u, 'study', await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } }).jpeg().toBuffer())).status).toBe(422) // too small to be a photo
    expect((await upload(u, 'study', await sharp({ create: { width: 400, height: 400, channels: 3, background: '#fff' } }).gif().toBuffer(), 'a.jpg')).status).toBe(422) // wrong real format
    expect((await rows(u.id)).length).toBe(0)
  })

  test('refuses files over 6 MB', async () => {
    const u = await makeUser('Amina')
    expect((await upload(u, 'study', Buffer.alloc(6 * 1024 * 1024 + 1))).status).toBe(413)
  })

  test('five uploads a day', async () => {
    const u = await makeUser('Amina'); const img = await jpeg()
    for (let i = 0; i < 5; i++) expect((await upload(u, 'study', img)).status).toBe(200)
    expect((await upload(u, 'study', img)).status).toBe(429)
  })

  test('a new upload replaces one still waiting; only one pending per mode, and the old file is deleted', async () => {
    const u = await makeUser('Amina')
    await upload(u, 'study', await jpeg()); const first = (await rows(u.id))[0]!
    await upload(u, 'study', await jpeg(800, 800))
    const all = await rows(u.id)
    expect(all.filter((r) => r.status === 'pending')).toHaveLength(1)
    expect(all.find((r) => r.id === first.id)!.status).toBe('replaced')
    expect(await store.get(first.storageKey)).toBeNull()
  })
})

describe('nobody sees a photo before staff approve it', () => {
  test('pending photo: the owner can see it; other students, signed-out visitors and Discover cannot', async () => {
    const amina = await makeUser('Amina'); const tunde = await makeUser('Tunde')
    await upload(amina, 'study', await jpeg())
    const id = (await rows(amina.id))[0]!.id
    expect((await fetchImg(amina, id)).status).toBe(200)
    expect((await fetchImg(tunde, id)).status).toBe(404)
    expect((await fetchImg(null, id)).status).toBe(401)
    expect((await discoverFor(tunde, 'study', 'Amina')).photoId).toBeNull()
  })

  test('after approval, same-campus students in that mode see it; the student is told it went live', async () => {
    const amina = await makeUser('Amina'); const tunde = await makeUser('Tunde')
    const id = await approvedPhoto(amina, 'study')
    expect((await discoverFor(tunde, 'study', 'Amina')).photoId).toBe(id)
    const img = await fetchImg(tunde, id)
    expect(img.status).toBe(200); expect(img.headers.get('content-type')).toBe('image/webp'); expect(img.headers.get('cache-control')).toContain('private')
    expect((await mine(amina)).study).toMatchObject({ approved: { id }, pending: null })
  })

  test('a photo belongs to one mode: it never shows in another mode, even for the same two students', async () => {
    const amina = await makeUser('Amina', { modes: ['study', 'friends'] }); const tunde = await makeUser('Tunde', { modes: ['study', 'friends'] })
    const id = await approvedPhoto(amina, 'study')
    expect((await discoverFor(tunde, 'friends', 'Amina')).photoId).toBeNull()
    // and the study photo cannot be fetched as a friends photo by someone who is only in friends
    const onlyFriends = await makeUser('Chidi', { modes: ['friends'] })
    expect((await fetchImg(onlyFriends, id)).status).toBe(404)
  })

  test('other campuses, blocked students and suspended students cannot see it', async () => {
    const amina = await makeUser('Amina'); const id = await approvedPhoto(amina, 'study')
    expect((await fetchImg(await makeUser('Zed', { university: 'unilag' }), id)).status).toBe(404)
    const blocked = await makeUser('Bayo'); await call(amina, 'POST', '/blocks', { userId: blocked.id })
    expect((await fetchImg(blocked, id)).status).toBe(404)
    const tunde = await makeUser('Tunde'); expect((await fetchImg(tunde, id)).status).toBe(200)
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, amina.id))
    expect((await fetchImg(tunde, id)).status).toBe(404)
  })
})

describe('Romance photos wait for a match', () => {
  test('hidden in Discover, in the conversation and from the image URL until the Spark is accepted', async () => {
    const amina = await makeUser('Amina', { modes: ['romance'], department: 'Cyber Security' }); const tunde = await makeUser('Tunde', { modes: ['romance'], department: 'Computer Science' })
    const id = await approvedPhoto(amina, 'romance')
    expect((await discoverFor(tunde, 'romance', 'Amina')).photoId).toBeNull()
    expect((await fetchImg(tunde, id)).status).toBe(404)

    const sent = await call(tunde, 'POST', '/connections', { toUserId: amina.id, intent: 'romance' })
    const reqId = (await discoverFor(tunde, 'romance', 'Amina')).request.id as string
    expect(sent.status).toBe(200)
    // a sent-but-unanswered Spark is not a match
    expect((await discoverFor(tunde, 'romance', 'Amina')).photoId).toBeNull()
    expect((await call(tunde, 'GET', '/conversations?intent=romance')).json.conversations[0].photoId).toBeNull()
    expect((await fetchImg(tunde, id)).status).toBe(404)

    expect((await call(amina, 'PATCH', `/connections/${reqId}`, { status: 'accepted' })).status).toBe(200)
    expect((await discoverFor(tunde, 'romance', 'Amina')).photoId).toBe(id)
    expect((await call(tunde, 'GET', '/conversations?intent=romance')).json.conversations[0].photoId).toBe(id)
    expect((await fetchImg(tunde, id)).status).toBe(200)
  })

  test('a declined Spark never reveals it', async () => {
    const amina = await makeUser('Amina', { modes: ['romance'], department: 'Cyber Security' }); const tunde = await makeUser('Tunde', { modes: ['romance'], department: 'Computer Science' })
    const id = await approvedPhoto(amina, 'romance')
    await call(tunde, 'POST', '/connections', { toUserId: amina.id, intent: 'romance' })
    const reqId = (await discoverFor(tunde, 'romance', 'Amina')).request.id as string
    await call(amina, 'PATCH', `/connections/${reqId}`, { status: 'declined' })
    expect((await fetchImg(tunde, id)).status).toBe(404)
  })

  test('study and friends photos are not held back the same way', async () => {
    const amina = await makeUser('Amina', { modes: ['friends'] }); const tunde = await makeUser('Tunde', { modes: ['friends'] })
    const id = await approvedPhoto(amina, 'friends')
    expect((await discoverFor(tunde, 'friends', 'Amina')).photoId).toBe(id)
  })
})

describe('staff review', () => {
  test('the queue and the image need the platform token and a staff session', async () => {
    const u = await makeUser('Amina'); await upload(u, 'study', await jpeg()); const id = (await rows(u.id))[0]!.id
    expect((await adminCall('GET', '/admin/photos', undefined, { token: null })).status).toBe(404)
    expect((await adminCall('GET', '/admin/photos')).status).toBe(401)
    expect((await adminCall('GET', `/admin/photos/${id}/image`)).status).toBe(401)
    const q = await A('GET', '/admin/photos')
    expect(q.json.pending).toHaveLength(1); expect(q.json.pending[0]).toMatchObject({ id, name: 'Amina', intent: 'study', replacing: false })
    expect((await A('GET', `/admin/photos/${id}/image`)).status).toBe(200)
    expect((await A('GET', '/admin/me')).json.photos).toBe(1)
  })

  test('rejecting keeps it hidden, deletes the file, and shows the student the reason', async () => {
    const u = await makeUser('Amina'); await upload(u, 'study', await jpeg()); const row = (await rows(u.id))[0]!
    expect((await A('POST', '/admin/photos/resolve', { photoId: row.id, action: 'reject', note: 'Your face is not visible.' })).status).toBe(200)
    expect((await fetchImg(await makeUser('Tunde'), row.id)).status).toBe(404)
    expect(await store.get(row.storageKey)).toBeNull()
    expect((await mine(u)).study).toMatchObject({ pending: null, approved: null, rejected: { note: 'Your face is not visible.' } })
    expect((await A('POST', '/admin/photos/resolve', { photoId: row.id, action: 'approve' })).status).toBe(409) // already decided
  })

  test('a replacement keeps the old photo live until approved, then swaps it and deletes the old file', async () => {
    const u = await makeUser('Amina'); const tunde = await makeUser('Tunde')
    const oldId = await approvedPhoto(u, 'study'); const oldKey = (await rows(u.id)).find((r) => r.id === oldId)!.storageKey
    await upload(u, 'study', await jpeg(800, 800)); const newId = (await rows(u.id)).find((r) => r.status === 'pending')!.id
    expect((await discoverFor(tunde, 'study', 'Amina')).photoId).toBe(oldId)          // old one still shown while the new one waits
    expect((await A('GET', '/admin/photos')).json.pending[0].replacing).toBe(true)
    await A('POST', '/admin/photos/resolve', { photoId: newId, action: 'approve' })
    expect((await discoverFor(tunde, 'study', 'Amina')).photoId).toBe(newId)
    expect((await fetchImg(tunde, oldId)).status).toBe(404)
    expect(await store.get(oldKey)).toBeNull()
  })

  test('staff can take a live photo down; the student can remove their own', async () => {
    const amina = await makeUser('Amina'); const tunde = await makeUser('Tunde')
    const id = await approvedPhoto(amina, 'study')
    expect((await A('POST', '/admin/photos/resolve', { photoId: id, action: 'remove', note: 'Not you.' })).status).toBe(200)
    expect((await fetchImg(tunde, id)).status).toBe(404)
    const again = await approvedPhoto(amina, 'study')
    expect((await call(tunde, 'DELETE', `/me/photos/${again}`)).status).toBe(404) // not theirs
    expect((await call(amina, 'DELETE', `/me/photos/${again}`)).status).toBe(200)
    expect((await fetchImg(tunde, again)).status).toBe(404)
  })

  test('every decision is in the audit log', async () => {
    const u = await makeUser('Amina'); await approvedPhoto(u, 'study')
    expect((await db.select().from(adminAudit)).map((a) => a.action)).toContain('photo.approve')
  })
})
