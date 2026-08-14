import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { VantResolver } from '@vant/auto-import-resolver'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    Components({
      resolvers: [VantResolver()],
    }),
  ],
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/opencc-js')) {
            return 'vendor-opencc'
          }
          if (id.includes('node_modules/vant')) {
            return 'vendor-vant'
          }
        },
      },
    },
  },
})
