import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    open: true, // 👈 automatically opens http://localhost:5173 in your default browser
  },
})
