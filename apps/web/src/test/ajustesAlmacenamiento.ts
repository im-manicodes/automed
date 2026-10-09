import type { AjustesAlmacenamiento } from '../lib/api'

/** Por defecto: RustFS ya configurado (con secreto guardado). */
export const ajustesAlmacenamiento = (o: Partial<AjustesAlmacenamiento> = {}): AjustesAlmacenamiento => ({
  configurado: true,
  origen: 'env',
  proveedor: 'rustfs',
  rustfs: { endpoint: 'http://rustfs:9000', bucket: 'auto-med', accessKey: 'rustfsadmin', tieneSecreto: true },
  s3: { region: 'us-east-1', bucket: '', accessKeyId: '', endpoint: '', tieneSecreto: false },
  ...o,
})
