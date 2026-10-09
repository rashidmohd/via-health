import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { loadDeviceKeys, saveDeviceKeys } from '../crypto/keyStore'
import { ME_KEY, useMe, type Me } from './auth'
import { api, ApiError } from './client'

/** Therapist and recovery keys (plan 0014). The private key is passphrase-encrypted. */
export interface Keys {
  therapist_public_key: string
  therapist_private_key: string
  recovery_public_key: string
  therapist_fingerprint: string
  recovery_fingerprint: string
}

export const KEYS_KEY = ['keys'] as const

/** The keys, or null when not set up. Falls back to the device copy when offline. */
export function useKeys(userId: string | undefined) {
  return useQuery({
    queryKey: KEYS_KEY,
    enabled: Boolean(userId),
    queryFn: async () => {
      try {
        const keys = await api<Keys>('/keys')
        await saveDeviceKeys(userId!, keys)
        return keys
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        if (error instanceof ApiError && error.code === 'network_error') {
          const local = await loadDeviceKeys(userId!)
          if (local) return local
        }
        throw error
      }
    },
    staleTime: Infinity,
  })
}

export function useSaveKeys(userId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (keys: Keys) => api<Keys>('/keys', { method: 'PUT', body: keys }),
    onSuccess: async (keys) => {
      await saveDeviceKeys(userId, keys)
      queryClient.setQueryData(KEYS_KEY, keys)
      queryClient.setQueryData<Me | null>(ME_KEY, (me) => (me ? { ...me, has_keys: true } : me))
    },
  })
}

/** Email the recovery key's check code to the therapist (ADR 0017). Only after they agree. */
export function useEmailCheckCode() {
  return useMutation({
    mutationFn: (checkCode: string) =>
      api<{ status: string }>('/keys/check-code-email', {
        method: 'POST',
        body: { check_code: checkCode, consent: true },
      }),
  })
}

/** The signed-in therapist's keys (null: not set up; undefined: still loading). */
export function useMyKeys() {
  const { data: me } = useMe()
  return useKeys(me?.id)
}
