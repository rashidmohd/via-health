import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Appearance } from '../avatar/appearance'
import { api, API_URL, ApiError } from './client'

export type Language = 'de' | 'en'
export type AvatarKind = 'illustrated' | 'drawn' | 'initials' | 'photo'

export interface Me {
  id: string
  email: string
  display_name: string
  ui_language: Language
  avatar_kind?: AvatarKind
  avatar_reactions?: boolean
  avatar_tilt?: boolean
  avatar_character?: number
  avatar_appearance?: Appearance | null
  has_photo?: boolean
}

export interface MeUpdate {
  display_name?: string
  ui_language?: Language
  avatar_kind?: AvatarKind
  avatar_reactions?: boolean
  avatar_tilt?: boolean
  avatar_character?: number
  avatar_appearance?: Appearance
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
    mutationFn: (body: MeUpdate) => api<Me>('/auth/me', { method: 'PATCH', body }),
    onSuccess: (me) => queryClient.setQueryData(ME_KEY, me),
  })
}

/* Profile photo (plan 0012). Shown as a data: URL — the CSP allows no blob: images. */

const PHOTO_KEY = ['auth', 'me', 'photo'] as const

async function readPhoto(): Promise<string | null> {
  let response: Response
  try {
    response = await fetch(`${API_URL}/auth/me/avatar`, { credentials: 'include' })
  } catch {
    throw new ApiError('network_error', 0)
  }
  if (response.status === 404) return null
  if (!response.ok) throw new ApiError('unknown', response.status)
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new ApiError('unknown', 0))
    reader.readAsDataURL(blob)
  })
}

export function usePhoto(enabled: boolean) {
  return useQuery({ queryKey: PHOTO_KEY, queryFn: readPhoto, enabled, staleTime: Infinity })
}

export function useUploadPhoto() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (photo: Blob) =>
      api<Me>('/auth/me/avatar', {
        method: 'PUT',
        bytes: new Uint8Array(await photo.arrayBuffer()),
        headers: { 'Content-Type': photo.type },
      }),
    onSuccess: (me) => {
      queryClient.setQueryData(ME_KEY, me)
      void queryClient.invalidateQueries({ queryKey: PHOTO_KEY })
    },
  })
}

/** Suggest a drawn avatar from a photo (ADR 0013). The photo is used once, never stored. */
export function useDescribePhoto() {
  return useMutation({
    mutationFn: async (photo: Blob) =>
      api<Appearance>('/auth/me/avatar/describe', {
        method: 'POST',
        bytes: new Uint8Array(await photo.arrayBuffer()),
        headers: { 'Content-Type': photo.type },
      }),
  })
}

export function useDeletePhoto() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<Me>('/auth/me/avatar', { method: 'DELETE' }),
    onSuccess: (me) => {
      queryClient.setQueryData(ME_KEY, me)
      queryClient.setQueryData(PHOTO_KEY, null)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => queryClient.setQueryData(ME_KEY, null),
  })
}
