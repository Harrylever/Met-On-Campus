import type { MetadataRoute } from 'next'
import { site } from '~/lib/site'

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ['', '/safety', '/universities', '/terms', '/privacy']
  return paths.map((p) => ({ url: `${site.url}${p}`, lastModified: new Date(), changeFrequency: p === '' ? 'weekly' : 'monthly', priority: p === '' ? 1 : 0.6 }))
}
