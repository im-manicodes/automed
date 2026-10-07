import type { AjustesIa, HardwareIa } from '../lib/api'

export const ajustesIa = (o: Partial<AjustesIa> = {}): AjustesIa => ({
  necesitaBienvenida: true,
  proveedor: 'ollama',
  origen: 'servidor',
  modelos: { resumen: 'qwen2.5vl:3b', whatsapp: 'qwen2.5vl:3b', evento: 'qwen2.5vl:3b', reporte: 'qwen2.5vl:3b', vision: 'qwen2.5vl:3b' },
  ollamaUrl: 'http://localhost:11434/v1',
  awsRegion: 'us-east-1',
  maxInputTokens: 24000,
  claves: { openai: false, anthropic: false },
  sugeridos: {
    ollama: { texto: ['qwen2.5vl:3b'], vision: ['qwen2.5vl:3b'] },
    openai: { texto: ['gpt-4o-mini', 'gpt-4o'], vision: ['gpt-4o'] },
    anthropic: { texto: ['claude-haiku-4-5'], vision: ['claude-sonnet-4-5'] },
    bedrock: { texto: ['amazon.nova-lite-v1:0'], vision: ['amazon.nova-pro-v1:0'] },
  },
  ...o,
})

export const hardwareIa = (o: Partial<HardwareIa> = {}): HardwareIa => ({
  entorno: 'local',
  ramGb: 16,
  cpus: 8,
  ollama: { alcanzable: true, version: '0.5.0', modelos: ['qwen2.5vl:3b'] },
  ollamaApto: { apto: true, velocidad: 'lenta', motivo: 'Funcionará, pero sin tarjeta gráfica será lento.' },
  ...o,
})
