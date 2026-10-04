/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  build: {
    rollupOptions: {
      output: {
        /*
         * 代码分割（需求 18.28 性能）：把体积较大且更新频率低的第三方依赖
         * 拆成独立 vendor chunk，减小主入口 chunk、利于浏览器长期缓存
         * （应用代码变更时 vendor chunk 的 hash 不变，无需重新下载）。
         * - react-vendor：react / react-dom 运行时；
         * - motion-vendor：framer-motion 动效库（本项目最大的单一依赖）。
         * 仅按包名静态归类，无副作用，不改变运行时行为与动效观感。
         */
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('framer-motion')) return 'motion-vendor';
            if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) {
              return 'react-vendor';
            }
          }
          return undefined;
        },
      },
    },
  },
});
