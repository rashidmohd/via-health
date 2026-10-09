import { useQuery } from '@tanstack/react-query'
import type { Keys } from '../../api/keys'
import type { AddendumRecord, ApprovedReport, NoteIndex, NoteRecord, Report } from '../../api/reports'
import type { Transcript } from '../../api/sessions'
import { unlockedKey, useUnlocked } from '../../crypto/keyring'
import { PgpError } from '../../crypto/pgp'
import { openRecord } from '../../crypto/records'

/** Signed notes are decrypted here, in memory, only while the key is unlocked (plan 0014).
 *  Locking changes the query key, and `gcTime: 0` drops the decrypted data with the last user. */

export interface OpenedReport {
  note: NoteRecord
  transcript: Transcript | null
  addenda: (AddendumRecord & { version: number })[]
}

function key() {
  const unlocked = unlockedKey()
  if (!unlocked) throw new PgpError('key_locked')
  return unlocked
}

export function useOpenedReport(report: Report | undefined, keys: Keys | null | undefined) {
  const unlocked = useUnlocked()
  const signed = report?.signed ?? null
  const addenda = report?.versions.filter((v) => v.kind === 'addendum' && v.message) ?? []
  return useQuery({
    queryKey: ['opened-report', report?.session_id, signed?.signed_at, addenda.length, unlocked],
    enabled: Boolean(signed && keys && unlocked),
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<OpenedReport> => {
      const [note, transcript, opened] = await Promise.all([
        openRecord<NoteRecord>(signed!.note, key(), keys!),
        signed!.transcript ? openRecord<Transcript>(signed!.transcript, key(), keys!) : Promise.resolve(null),
        Promise.all(
          addenda.map(async (v) => ({
            version: v.version,
            ...(await openRecord<AddendumRecord>(v.message!, key(), keys!)),
          })),
        ),
      ])
      return { note, transcript, addenda: opened }
    },
  })
}

/** Number, type and topics of signed notes on the Reports page, by session id. */
export function useOpenedIndexes(reports: ApprovedReport[] | undefined, keys: Keys | null | undefined) {
  const unlocked = useUnlocked()
  const signed = (reports ?? []).filter((r) => r.signed && r.index)
  return useQuery({
    queryKey: ['opened-indexes', signed.map((r) => r.session_id).join(','), unlocked],
    enabled: Boolean(signed.length && keys && unlocked),
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const entries = await Promise.all(
        signed.map(async (r) => {
          try {
            return [r.session_id, await openRecord<NoteIndex>(r.index!, key(), keys!)] as const
          } catch {
            return null // one unreadable row must not hide the others
          }
        }),
      )
      return new Map(entries.filter((e) => e !== null))
    },
  })
}
