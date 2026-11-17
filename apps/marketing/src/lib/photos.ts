// Photos from Unsplash, hotlinked from their CDN as Unsplash's guidelines require. Each was registered with
// Unsplash's download endpoint when chosen, and must keep its photographer credit visible wherever it is shown.
export type Photo = { id: string; alt: string; raw: string; ixid: string; page: string; author: string; authorUrl: string }

export const PHOTOS: Record<'study' | 'friends' | 'romance', Photo> = {
  study: {
    id: 'HA-0i0E7sq4',
    alt: 'A young woman with long braids working on a laptop at a desk by a window',
    raw: 'https://images.unsplash.com/photo-1604933762021-54a5858c9832',
    ixid: 'M3wxMDcxNTgzfDB8MXxzZWFyY2h8MXx8YWZyaWNhbiUyMHdvbWFuJTIwc3R1ZGVudCUyMHN0dWR5aW5nJTIwbGFwdG9wfGVufDF8MHx8fDE3OTQ5MjUxMDh8MA',
    page: 'https://unsplash.com/photos/woman-using-laptop-in-workspace-HA-0i0E7sq4',
    author: 'Daniel Thomas',
    authorUrl: 'https://unsplash.com/@spintracer',
  },
  friends: {
    id: 'jDXMQf3LPX8',
    alt: 'Students laughing together on a balcony outside their hostel',
    raw: 'https://images.unsplash.com/photo-1648301033733-44554c74ec50',
    ixid: 'M3wxMDcxNTgzfDB8MXxhbGx8fHx8fHx8fHwxNzk0OTI0MDczfA',
    page: 'https://unsplash.com/photos/a-group-of-people-sitting-on-the-side-of-a-building-jDXMQf3LPX8',
    author: 'Creab ThePolymath',
    authorUrl: 'https://unsplash.com/@cr_eab',
  },
  romance: {
    id: 'sdDh9Zm1VsU',
    alt: 'A couple walking hand in hand at sunset',
    raw: 'https://images.unsplash.com/photo-1763328737458-b5bf0fb32aa0',
    ixid: 'M3wxMDcxNTgzfDB8MXxhbGx8fHx8fHx8fHwxNzk0OTI0MDc1fA',
    page: 'https://unsplash.com/photos/couple-walking-hand-in-hand-outdoors-sdDh9Zm1VsU',
    author: 'Christian Agbede',
    authorUrl: 'https://unsplash.com/@chriscreations__',
  },
}

const utm = 'utm_source=met_on_campus&utm_medium=referral'
export const withUtm = (url: string) => `${url}?${utm}`

/** Unsplash CDN URL resized for a given width, cropped toward faces. */
export const photoSrc = (p: Photo, w: number, h = Math.round(w * 0.625)) =>
  `${p.raw}?ixid=${p.ixid}&ixlib=rb-4.1.0&auto=format&fit=crop&crop=faces%2Centropy&q=75&w=${w}&h=${h}`
