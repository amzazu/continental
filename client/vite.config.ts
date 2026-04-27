import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Must come before the general @shared alias so it matches first
      { find: '@shared/types', replacement: path.resolve(__dirname, '../shared/types.ts') },
      { find: '@shared', replacement: path.resolve(__dirname, '../shared') },
    ],
  },
})
