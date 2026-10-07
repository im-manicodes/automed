import type { AjustesOcr } from '../lib/api'

/** Por defecto: servidor con el servicio de OCR local detenido. */
export const ajustesOcr = (o: Partial<AjustesOcr> = {}): AjustesOcr => ({
  motor: 'ninguno',
  origen: 'servidor',
  textractMode: 'detect',
  entorno: { servidor: true },
  servicioLocal: { estado: 'detenido' },
  ...o,
})
