import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import path from "path"

import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui': ['framer-motion', 'lucide-react', 'clsx', 'tailwind-merge'],
          'vendor-utils': ['zustand', 'date-fns']
        }
      }
    }
  },
  server: {
    allowedHosts: true,
    proxy: {
      /*
      '/api/inventory': {
        target: 'https://altf-web-data-prod.s3.ap-northeast-2.amazonaws.com/public/inventory',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/inventory/, ''),
      },
      */
      '/api/quote': {
        target: 'https://altf-api.onrender.com',
        changeOrigin: true,
      },
      '/api/geo': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api/weather': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api/my': {
        target: 'https://altf-api.onrender.com',
        changeOrigin: true,
      },
      '/api/auth': {
        target: 'https://altf-api.onrender.com',
        changeOrigin: true,
      },
      '/api/users': {
        target: 'https://altf-api.onrender.com',
        changeOrigin: true,
      },
    },
  },
})
