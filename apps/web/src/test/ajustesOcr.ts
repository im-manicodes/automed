import type { AjustesOcr } from '../lib/api'

/** Por defecto: servidor con el servicio de OCR local detenido. */
export const ajustesOcr = (o: Partial<AjustesOcr> = {}): AjustesOcr => ({
  motor: 'ninguno',
  origen: 'servidor',
  textractMode: 'detect',
  visionRetry: true,
  visionSegundoIntento: true,
  visionMaxRegions: 40,
  renderDpi: 200,
  visionAmbito: '',
  visionAmbitoPorDefecto: 'Documentos clínicos.',
  azureEndpoint: '',
  claveAzure: false,
  entorno: { servidor: true },
  servicioLocal: { estado: 'detenido' },
  ...o,
})
