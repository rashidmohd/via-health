import type { ClientSummary } from '../../api/clients'
import { db } from '../../recorder/db'

/** Remember who may be recorded, so starting a session also works offline.
 *  The server re-checks consent for the session and every chunk. */
export async function cacheConsent(clients: ClientSummary[]): Promise<void> {
  const updatedAt = new Date().toISOString()
  await db.transaction('rw', db.consent, async () => {
    await db.consent.clear()
    await db.consent.bulkPut(
      clients.map((c) => ({ clientId: c.id, name: c.name, ready: c.ready_to_record, updatedAt })),
    )
  })
}
