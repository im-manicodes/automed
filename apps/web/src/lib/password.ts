export const MIN_PASSWORD = 10

export function validarNuevaPassword(actual: string, nueva: string, confirmar: string): string | null {
  if (!actual) return 'Escribe tu contraseña actual.'
  if (nueva.length < MIN_PASSWORD) return `La contraseña nueva debe tener al menos ${MIN_PASSWORD} caracteres.`
  if (nueva !== confirmar) return 'Las contraseñas nuevas no coinciden.'
  if (nueva === actual) return 'La contraseña nueva debe ser distinta de la actual.'
  return null
}

