import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  return {
    plugins: [react()],
    // 如果是 build（打包发布），就用 /game/ 路径
    // 如果是 serve（本地开发），就用根路径 /
    base: command === 'build' ? '/game/' : '/',
  }
})