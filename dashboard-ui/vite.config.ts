import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: parseInt(process.env.FRONTEND_PORT || '5173'),
    host: '0.0.0.0',
  },
  logLevel: 'warn', // Reduz logs do Vite
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Fix para Windows com caracteres especiais no path
  esbuild: {
    loader: 'tsx',
    include: /.*\.(tsx?|jsx?)$/,
    exclude: []
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
        '.ts': 'tsx',
        '.tsx': 'tsx'
      }
    }
  }
})
