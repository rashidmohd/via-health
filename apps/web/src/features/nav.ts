export const NAV_ITEMS = [
  { key: 'today', path: '/' },
  { key: 'clients', path: '/clients' },
  { key: 'sessions', path: '/sessions' },
  { key: 'reports', path: '/reports' },
  { key: 'keys', path: '/keys' },
  { key: 'settings', path: '/settings' },
] as const

export type NavKey = (typeof NAV_ITEMS)[number]['key']
