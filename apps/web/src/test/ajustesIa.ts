import type { AjustesIa, HardwareIa } from '../lib/api'

export const ajustesIa = (o: Partial<AjustesIa> = {}): AjustesIa => ({
  necesitaBienvenida: true,
  proveedor: 'ollama',
  origen: 'servidor',
  modelos: { resumen: 'qwen3-vl:4b-instruct', whatsapp: 'qwen3-vl:4b-instruct', evento: 'qwen3-vl:4b-instruct', reporte: 'qwen3-vl:4b-instruct', vision: 'qwen3-vl:4b-instruct' },
  ollamaUrl: 'http://localhost:11434/v1',
  awsRegion: 'us-east-1',
  maxInputTokens: 24000,
  claves: { openai: false, anthropic: false, aws: false },
  sugeridos: {
    ollama: { texto: ['qwen3-vl:4b-instruct'], vision: ['qwen3-vl:4b-instruct'] },
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
  ollama: { alcanzable: true, version: '0.12.8', modelos: ['qwen3-vl:4b-instruct'] },
  ollamaApto: { apto: true, velocidad: 'lenta', motivo: 'Funcionará, pero sin tarjeta gráfica será lento.' },
  ...o,
})
