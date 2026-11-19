// Small stroke icons (24px grid, currentColor). Decorative: the visible or screen-reader label carries the meaning.
const paths: Record<string, React.ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  reports: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.2 2.4 3.5 5.2" /></>,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  health: <><path d="M12 21s-8-4.6-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.4-8 11-8 11z" /></>,
  campuses: <><path d="M4 21V8l8-5 8 5v13" /><path d="M9 21v-6h6v6" /><path d="M9 11h.01M15 11h.01" /></>,
  departments: <><path d="M3 10l9-5 9 5-9 5-9-5z" /><path d="M7 12.5V17c0 1.2 2.2 2.5 5 2.5s5-1.3 5-2.5v-4.5" /><path d="M21 10v5" /></>,
  announce: <><path d="M4 10v4a1 1 0 0 0 1 1h2l8 4V5L7 9H5a1 1 0 0 0-1 1z" /><path d="M18.5 9a4 4 0 0 1 0 6" /></>,
  spots: <><path d="M12 21s-6.5-5.4-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.6 12 21 12 21z" /><circle cx="12" cy="10.5" r="2.3" /></>,
  photos: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10.5" r="1.8" /><path d="M21 16l-5-4.5L8 19" /></>,
  audit: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  signout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
  collapse: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 9l-3 3 3 3" /></>,
  expand: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M13 9l3 3-3 3" /></>,
}
export type IconName = keyof typeof paths
export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>{paths[name]}</svg>
}
