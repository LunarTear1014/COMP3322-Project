import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fixturePlugin } from './dev/fixtures.js'

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'fixtures' ? [fixturePlugin()] : [])],
  server: { proxy: mode === 'fixtures' ? {} : { '/api': 'http://localhost:3000' } },
}))
