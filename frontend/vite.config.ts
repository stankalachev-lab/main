import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          apexcharts: ['apexcharts', 'vue3-apexcharts'],
          vue: ['vue', 'vue-router', 'pinia'],
        },
      },
    },
  },
})
