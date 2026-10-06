import { useQuery } from '../../../hooks/useQuery';
import type { ApiPagesResponse } from '../lib/types';

/** Páginas, OCR y dudas de un adjunto para la pantalla de revisión. */
export function usePaginasAdjunto(attachmentId: string) {
  return useQuery<ApiPagesResponse>({ url: `/attachments/${encodeURIComponent(attachmentId)}/pages` });
}
