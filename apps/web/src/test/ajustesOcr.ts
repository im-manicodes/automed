import type { AjustesOcr, GuiaPython } from '../lib/api'

export const guiaPython = (o: Partial<GuiaPython> = {}): GuiaPython => ({
  titulo: 'Instalar Python 3.11 en Linux',
  pasos: ['Abre una terminal.', 'Copia y ejecuta el comando.'],
  comandos: ['sudo apt install python3.11 python3.11-venv'],
  enlace: 'https://www.python.org/downloads/',
  ...o,
})

/** Por defecto: computador de escritorio con Python 3.11 compatible, entorno sin preparar. */
export const ajustesOcr = (o: Partial<AjustesOcr> = {}): AjustesOcr => ({
  motor: 'ninguno',
  origen: 'servidor',
  textractMode: 'detect',
  entorno: { escritorio: true, servidor: false, so: 'linux' },
  python: { requerido: '3.11', rango: '3.10 a 3.12', detectado: true, version: '3.11.9', ejecutable: '/usr/bin/python3.11', compatible: true, guia: guiaPython() },
  entornoPython: { estado: 'sin_preparar' },
  servicioLocal: { estado: 'detenido' },
  ...o,
})

export const sinPython = (): AjustesOcr =>
  ajustesOcr({ python: { requerido: '3.11', rango: '3.10 a 3.12', detectado: false, compatible: false, guia: guiaPython() } })

export const pythonViejo = (): AjustesOcr =>
  ajustesOcr({
    python: {
      requerido: '3.11', rango: '3.10 a 3.12', detectado: true, version: '3.8.10', compatible: false,
      motivo: 'Es una versión muy antigua.', guia: guiaPython({ titulo: 'Instalar una versión más nueva de Python' }),
    },
  })
