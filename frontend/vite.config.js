import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const rawApi = env.VITE_API_URL || 'http://localhost:4000/api'
  const apiOrigin = rawApi.replace(/\/api\/?$/i, '') || 'http://localhost:4000'

  return {
    plugins: [
      react(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.js',
        registerType: 'autoUpdate',
        injectManifest: {
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,jpeg,svg,woff2}'],
        },
        manifest: {
          name: 'Aduu ERP - POS & Quản lý F&B',
          short_name: 'Aduu ERP',
          description: 'ERP F&B all-in-one: POS, sơ đồ bàn, KDS, kế toán VAS, hóa đơn điện tử, AI dự báo — cho quán ăn, cafe, nhà hàng VN',
          theme_color: '#0d9488',
          background_color: '#f8fafc',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          lang: 'vi',
          icons: [
            { src: '/aduu.jpeg', sizes: '192x192', type: 'image/jpeg', purpose: 'any maskable' },
            { src: '/aduu.jpeg', sizes: '512x512', type: 'image/jpeg', purpose: 'any maskable' },
          ],
          categories: ['business', 'finance', 'productivity'],
          shortcuts: [
            {
              name: 'Bán hàng',
              short_name: 'POS',
              url: '/pos',
            },
            {
              name: 'Đơn hàng',
              short_name: 'Orders',
              url: '/orders',
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5173,
      open: false,
      proxy: {
        '/api': {
          target: apiOrigin,
          changeOrigin: true,
        },
        '/socket.io': {
          target: apiOrigin,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  }
})
