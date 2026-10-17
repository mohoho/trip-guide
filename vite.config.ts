import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { exportToDisplayPlugin } from './vite-plugin-export-to-display.ts'

export default defineConfig({
  // 相对路径产物：静态托管把站点挂在 /site/<id>/ 这类前缀下时，绝对 /assets 会跑出站点
  base: './',
  plugins: [react(), tailwindcss(), exportToDisplayPlugin()],
  server: { port: 5173 },
})
