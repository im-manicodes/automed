import { useQuery } from '../../../hooks/useQuery'
import type { AttachmentPages } from '../../../lib/api'

/** Páginas y regiones de un PDF adjunto; `enabled` permite pedirlas solo cuando hacen falta. */
export function useAttachmentPages(id: string, enabled = true) {
  return useQuery<AttachmentPages>({ url: `/attachments/${encodeURIComponent(id)}/pages`, enabled: enabled && !!id })
}
