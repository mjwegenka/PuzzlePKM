import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: [
                'electron',
                // node built-ins
                /^node:/,
              ],
            },
          },
          resolve: {
            alias: {
              '@shared': path.join(__dirname, 'src/shared'),
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            rollupOptions: {
              external: ['electron', /^node:/],
            },
          },
          resolve: {
            alias: {
              '@shared': path.join(__dirname, 'src/shared'),
            },
          },
        },
      },
      renderer: process.env.NODE_ENV === 'test' ? undefined : {},
    }),
  ],
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
      '@shared': path.join(__dirname, 'src/shared'),
    },
  },
})
