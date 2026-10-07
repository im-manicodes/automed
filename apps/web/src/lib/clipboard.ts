/**
 * Copia texto al portapapeles. `navigator.clipboard` solo existe en contextos seguros (https o
 * localhost) y exige permiso/foco del documento; si falla, cae a un textarea oculto +
 * `document.execCommand('copy')`. Devuelve true solo si realmente se copió.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && globalThis.isSecureContext !== false) {
      await navigator.clipboard.writeText(texto)
      return true
    }
  } catch {
    // contexto no seguro, permiso denegado o documento sin foco: se intenta el método clásico
  }
  return copiarConTextarea(texto)
}

function copiarConTextarea(texto: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false
  const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const ta = document.createElement('textarea')
  ta.value = texto
  ta.setAttribute('readonly', '')
  ta.setAttribute('aria-hidden', 'true')
  // fuera de pantalla, pero seleccionable (display:none impide copiar); 16px evita el zoom en iOS
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:16px;'
  document.body.appendChild(ta)
  try {
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, texto.length)
    return typeof document.execCommand === 'function' && document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(ta)
    previo?.focus()
  }
}
