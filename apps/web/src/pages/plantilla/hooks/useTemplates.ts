import { useMutation } from '../../../hooks/useMutation'
import { useQuery } from '../../../hooks/useQuery'
import type { ColumnaReporte, Template, TemplateKind } from '../../../lib/api'

export interface PreviewResult {
  markdown: string
  columnas?: ColumnaReporte[]
  error?: string | null
}

/** Plantilla activa de un tipo. */
export function useTemplate(kind: TemplateKind, onSuccess?: (t: Template) => void) {
  return useQuery<Template>({ url: `/templates/active?kind=${kind}`, onSuccess })
}

export function useSaveTemplate(kind: TemplateKind) {
  return useMutation<Template, { markdown: string }>({ url: `/templates/active?kind=${kind}`, method: 'PUT' })
}

export function useResetTemplate(kind: TemplateKind) {
  return useMutation<Template>({ url: `/templates/reset?kind=${kind}` })
}

export function usePreviewTemplate() {
  return useMutation<PreviewResult, { markdown?: string; kind: TemplateKind }>({ url: '/templates/preview' })
}
