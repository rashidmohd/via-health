import { Bell, CalendarDays, FileText, House, KeyRound, Settings, Users, type LucideIcon } from 'lucide-react'

export const NAV_ITEMS = [
  { key: 'today', path: '/', group: 'workspace' },
  { key: 'notifications', path: '/notifications', group: 'workspace' },
  { key: 'clients', path: '/clients', group: 'workspace' },
  { key: 'sessions', path: '/sessions', group: 'workspace' },
  { key: 'reports', path: '/reports', group: 'workspace' },
  { key: 'keys', path: '/keys', group: 'account' },
  { key: 'settings', path: '/settings', group: 'account' },
] as const

export type NavKey = (typeof NAV_ITEMS)[number]['key']

export const NAV_GROUPS = ['workspace', 'account'] as const

export const NAV_ICONS: Record<NavKey, LucideIcon> = {
  today: House,
  notifications: Bell,
  clients: Users,
  sessions: CalendarDays,
  reports: FileText,
  keys: KeyRound,
  settings: Settings,
}
