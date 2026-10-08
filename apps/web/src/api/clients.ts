import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Language } from './auth'
import { api } from './client'

export type ConsentKind = 'recording' | 'ai_processing' | 'product_improvement'
export type ConsentStatus = 'granted' | 'outdated' | 'withdrawn' | 'missing'
export type ClientStatus = 'active' | 'restricted' | 'archived'

export const CONSENT_KINDS: ConsentKind[] = ['recording', 'ai_processing', 'product_improvement']
export const REQUIRED_KINDS: ConsentKind[] = ['recording', 'ai_processing']

export interface Identity {
  name: string
  date_of_birth?: string | null
  email?: string | null
  phone?: string | null
}

export interface ClientSummary {
  id: string
  name: string
  preferred_language: Language
  status: ClientStatus
  consent: Record<ConsentKind, ConsentStatus>
  ready_to_record: boolean
  last_session_at: string | null
  created_at: string
}

export interface ConsentRecord {
  id: string
  kind: ConsentKind
  text_version: number
  language: Language
  granted_at: string
  withdrawn_at: string | null
  signed_by: 'client' | 'guardian'
  method: string
}

export interface ClientDetail extends ClientSummary {
  identity: Identity
  consents: ConsentRecord[]
}

export interface ConsentText {
  id: string
  kind: ConsentKind
  version: number
  language: Language
  body: string
}

const CLIENTS_KEY = ['clients'] as const
const clientKey = (id: string) => ['clients', id] as const

export function useClients() {
  return useQuery({ queryKey: CLIENTS_KEY, queryFn: () => api<ClientSummary[]>('/clients') })
}

export function useClient(id: string) {
  return useQuery({ queryKey: clientKey(id), queryFn: () => api<ClientDetail>(`/clients/${id}`) })
}

export function useConsentTexts(language: Language) {
  return useQuery({
    queryKey: ['consent-texts', language],
    queryFn: () => api<ConsentText[]>(`/consent-texts?language=${language}`),
    staleTime: 10 * 60_000,
  })
}

/** Every write returns the updated client: refresh its cache entry and the list. */
function useClientWrite<A>(fn: (args: A) => Promise<ClientDetail>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (client) => {
      queryClient.setQueryData(clientKey(client.id), client)
      void queryClient.invalidateQueries({ queryKey: CLIENTS_KEY, exact: true })
    },
  })
}

export function useCreateClient() {
  return useClientWrite((body: Identity & { preferred_language: Language }) =>
    api<ClientDetail>('/clients', { method: 'POST', body }),
  )
}

export function useUpdateClient(id: string) {
  return useClientWrite(
    (body: { identity?: Identity; preferred_language?: Language; status?: 'active' | 'archived' }) =>
      api<ClientDetail>(`/clients/${id}`, { method: 'PATCH', body }),
  )
}

export function useGrantConsents(id: string) {
  return useClientWrite(
    (body: {
      kinds: ConsentKind[]
      language: Language
      signed_by: 'client' | 'guardian'
      signature: string
    }) => api<ClientDetail>(`/clients/${id}/consents`, { method: 'POST', body }),
  )
}

export function useWithdrawConsent() {
  return useClientWrite((consentId: string) =>
    api<ClientDetail>(`/consents/${consentId}/withdraw`, { method: 'POST' }),
  )
}
