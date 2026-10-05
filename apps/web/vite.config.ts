import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// El .env vive en la raíz del monorepo (único para todo el proyecto).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../../', '')
  return {
    envDir: '../../',
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      port: 5173,
      proxy: { '/api': env.VITE_API_URL ?? 'http://localhost:3000' },
    },
  }
})
