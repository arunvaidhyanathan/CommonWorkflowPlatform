import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Dev-server proxies mirror the gateway's routes (gateway/templates/cwp.conf.template)
// so `npm run dev` works against services run natively, with VITE_API_BASE_URL=/api.
const RUNTIME = process.env.CWP_RUNTIME_URL ?? 'http://localhost:8081'
const IDENTITY = process.env.CWP_IDENTITY_URL ?? 'http://localhost:8082'
const AGENT = process.env.CWP_AGENT_URL ?? 'http://localhost:8091'
const SPEND = process.env.CWP_SPEND_URL ?? 'http://localhost:8095'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      // First match wins: the identity routes must come before /api/runtime.
      '/api/identity': { target: IDENTITY, rewrite: (p) => p.replace(/^\/api/, '') },
      // Legacy paths the SPA still calls, now served by identity-service.
      '^/api/runtime/auth/': { target: IDENTITY, rewrite: (p) => p.replace(/^\/api\/runtime/, '/identity') },
      '^/api/runtime/design/(members|invites|me)(/|$|\\?)': {
        target: IDENTITY,
        rewrite: (p) => p.replace(/^\/api\/runtime\/design/, '/identity'),
      },
      '/api/flowable': { target: RUNTIME, rewrite: (p) => p.replace(/^\/api\/flowable/, '/runtime') },
      '/api/runtime': { target: RUNTIME, rewrite: (p) => p.replace(/^\/api/, '') },
      '/api/agent': { target: AGENT, rewrite: (p) => p.replace(/^\/api\/agent/, '') },
      // /api/spend/events is service-to-service only, as at the gateway.
      '^/api/spend/(?!events$)': { target: SPEND, rewrite: (p) => p.replace(/^\/api\/spend/, '') },
    },
  },
})
