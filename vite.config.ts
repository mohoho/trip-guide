import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { exportToDisplayPlugin } from './vite-plugin-export-to-display.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), exportToDisplayPlugin()],
  server: { port: 5173 },
})
