import { site } from '~/lib/site'

/** Contact address from NEXT_PUBLIC_CONTACT_EMAIL. Without one, say so plainly instead of inventing an address. */
export function Contact({ children }: { children?: React.ReactNode }) {
  if (!site.contactEmail) return <span>our contact details, which we are still setting up</span>
  return <a href={`mailto:${site.contactEmail}`}>{children ?? site.contactEmail}</a>
}
