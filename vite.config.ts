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
  esbuild: {
    drop: ['console', 'debugger'], // [SECURITY] Remove all console.logs and debuggers in production
  },
  build: {
    sourcemap: false, // [SECURITY] Prevent source code leak in production
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
      '/api/inventory': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/admin': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
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
      '/api/customers': {
        target: 'https://altf-api.onrender.com',
        changeOrigin: true,
      },
    },
  },
})
