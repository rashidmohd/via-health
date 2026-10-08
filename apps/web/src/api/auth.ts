import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from './client'

export type Language = 'de' | 'en'

export interface Me {
  id: string
  email: string
  display_name: string
  ui_language: Language
}

export const ME_KEY = ['auth', 'me'] as const

/** The logged-in user, or null when not logged in. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api<Me>('/auth/me')
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
  })
}

export function startEmailLogin(email: string, language: Language) {
  return api<{ status: string }>('/auth/email/start', {
    method: 'POST',
    body: { email, language },
  })
}

export function verifyEmailCode(body: {
  email: string
  code: string
  display_name?: string
  language: Language
}) {
  return api<Me>('/auth/email/verify', { method: 'POST', body })
}

export function useUpdateMe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { display_name?: string; ui_language?: Language }) =>
      api<Me>('/auth/me', { method: 'PATCH', body }),
    onSuccess: (me) => queryClient.setQueryData(ME_KEY, me),
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => queryClient.setQueryData(ME_KEY, null),
  })
}
