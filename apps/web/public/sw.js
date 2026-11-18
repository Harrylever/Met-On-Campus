// Met On Campus service worker. Deliberately small, and it never caches the app or any account data:
//  1. an offline page, shown only when a page load fails because there is no connection;
//  2. receives push notifications and shows them;
//  3. opens the right screen when a notification is tapped.
const VERSION = 'v1'
const OFFLINE = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  // Only page loads. Everything else (scripts, the API, images of people) goes straight to the network, untouched.
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)))
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* a malformed push still gets a generic notice below */ }
  // Every push must show something (browsers, iPhones especially, drop the subscription of a site that stays silent).
  event.waitUntil(self.registration.showNotification(data.title || 'Met On Campus', {
    body: data.body || 'You have something new',
    tag: data.tag || 'general',            // one notification per kind: a new one replaces the last instead of piling up
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url: typeof data.url === 'string' ? data.url : '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // Only ever open pages on our own origin, whatever the payload says.
  let target = new URL('/', self.location.origin)
  try { const u = new URL(event.notification.data && event.notification.data.url || '/', self.location.origin); if (u.origin === self.location.origin) target = u } catch { /* keep home */ }
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = open.find((c) => new URL(c.url).origin === self.location.origin)
    if (existing) {
      await existing.focus()
      try { await existing.navigate(target.href) } catch { /* not controllable: fall through to a new window */ return self.clients.openWindow(target.href) }
      return
    }
    return self.clients.openWindow(target.href)
  })())
})
