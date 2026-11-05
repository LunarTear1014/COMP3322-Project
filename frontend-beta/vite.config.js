import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fixturePlugin } from './dev/fixtures.js'

export default defineConfig(({ mode }) => {
  const proxy = mode === 'fixtures' ? {} : {
    '/api': process.env.CLUBSPACE_API_TARGET || 'http://localhost:3000',
  }
  return {
    plugins: [react(), ...(mode === 'fixtures' ? [fixturePlugin()] : [])],
    server: { proxy },
    preview: { proxy },
  }
})
