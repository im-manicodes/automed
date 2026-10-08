import type { AjustesAlmacenamiento, CambiosAlmacenamiento, ProveedorAlmacenamiento } from './api'

/** Lo que el usuario escribe; los secretos viven solo aquí, nunca vienen de la API. */
export interface BorradorAlmacenamiento {
  proveedor: ProveedorAlmacenamiento
  rustfs: { endpoint: string; bucket: string; accessKey: string; secretKey: string }
  s3: { region: string; bucket: string; accessKeyId: string; secretAccessKey: string; endpoint: string }
}

export const PROVEEDORES_ALMACENAMIENTO: { id: ProveedorAlmacenamiento; nombre: string; descripcion: string }[] = [
  { id: 'rustfs', nombre: 'RustFS', descripcion: 'Tu propio servidor de archivos compatible con S3.' },
  { id: 's3', nombre: 'AWS S3', descripcion: 'Un bucket de Amazon Web Services.' },
]

export function nombreAlmacenamiento(p: ProveedorAlmacenamiento | null): string {
  return PROVEEDORES_ALMACENAMIENTO.find((x) => x.id === p)?.nombre ?? 'Sin configurar'
}

export function borradorAlmacenamientoDesde(a: AjustesAlmacenamiento): BorradorAlmacenamiento {
  return {
    proveedor: a.proveedor ?? 'rustfs',
    rustfs: { endpoint: a.rustfs.endpoint, bucket: a.rustfs.bucket, accessKey: a.rustfs.accessKey, secretKey: '' },
    s3: { region: a.s3.region, bucket: a.s3.bucket, accessKeyId: a.s3.accessKeyId, secretAccessKey: '', endpoint: a.s3.endpoint },
  }
}

/** Cuerpo para PUT/POST test: solo el proveedor elegido; secretos vacíos se omiten (conservar el guardado). */
export function cuerpoAlmacenamiento(b: BorradorAlmacenamiento): CambiosAlmacenamiento {
  if (b.proveedor === 'rustfs') {
    const r = b.rustfs
    return {
      proveedor: 'rustfs',
      rustfs: { endpoint: r.endpoint.trim(), bucket: r.bucket.trim(), accessKey: r.accessKey.trim(), ...(r.secretKey ? { secretKey: r.secretKey } : {}) },
    }
  }
  const s = b.s3
  return {
    proveedor: 's3',
    s3: {
      region: s.region.trim(),
      bucket: s.bucket.trim(),
      ...(s.accessKeyId.trim() ? { accessKeyId: s.accessKeyId.trim() } : {}),
      ...(s.secretAccessKey ? { secretAccessKey: s.secretAccessKey } : {}),
      ...(s.endpoint.trim() ? { endpoint: s.endpoint.trim() } : {}),
    },
  }
}

/** Qué falta para poder guardar/probar, o null si está completo. */
export function faltaAlmacenamiento(b: BorradorAlmacenamiento, a: AjustesAlmacenamiento): string | null {
  if (b.proveedor === 'rustfs') {
    const r = b.rustfs
    if (!r.endpoint.trim() || !r.bucket.trim() || !r.accessKey.trim()) return 'Completa la dirección, el bucket y la clave de acceso.'
    if (!r.secretKey && !a.rustfs.tieneSecreto) return 'Escribe la clave secreta.'
    return null
  }
  const s = b.s3
  if (!s.region.trim() || !s.bucket.trim()) return 'Completa la región y el bucket.'
  return null
}
