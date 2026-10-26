/// <reference types="vitest/config" />
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import type { Connect, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/*
 * 「实用简历管理」内嵌的是本地镜像的简历编辑器（源自开源 Magic Resume，
 * 已改写品牌文案、移除 GitHub 入口），文件放在 public/resume-site/ 下。
 * 该应用按站点根路径取资源（/assets、/fonts、/landing）并用 /zh、/app/dashboard
 * 这类无扩展名路径做路由，所以这里把根路径映射回 resume-site 目录并支持目录索引。
 */
const RESUME_SITE_DIR = fileURLToPath(new URL('./public/resume-site/', import.meta.url));
const RESUME_SITE_EXACT = new Set(['/zh', '/en']);
const RESUME_SITE_PREFIXES = ['/app/', '/assets/', '/landing/', '/fonts/'];
/** 动态路由（/app/workbench/:id 等）没有对应的静态文件，回落到该路由的入口页。 */
const RESUME_SITE_SHELLS: Array<[string, string]> = [
  ['/app/workbench/', 'app/workbench/index.html'],
  ['/app/preview-template/', 'app/preview-template/index.html'],
];
const RESUME_SITE_FALLBACK_SHELL = 'app/dashboard/index.html';
const RESUME_SITE_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const resumeSiteMirror = (): Plugin => {
  const serveResumeSite: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url ?? '';
    const pathname = decodeURIComponent(url.split('?')[0].split('#')[0]);
    const relative = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    const isResumeSitePath =
      RESUME_SITE_EXACT.has(pathname) ||
      RESUME_SITE_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
      (relative !== '' && fs.existsSync(path.resolve(RESUME_SITE_DIR, relative)));
    if (!isResumeSitePath) {
      next();
      return;
    }
    const candidates = relative ? [relative, `${relative}/index.html`] : ['index.html'];
    if (relative) {
      const shell = RESUME_SITE_SHELLS.find(([prefix]) => pathname.startsWith(prefix));
      if (shell) {
        candidates.push(shell[1]);
      } else if (pathname.startsWith('/app/')) {
        candidates.push(RESUME_SITE_FALLBACK_SHELL);
      }
    }
    for (const candidate of candidates) {
      const filePath = path.resolve(RESUME_SITE_DIR, candidate);
      if (!filePath.startsWith(RESUME_SITE_DIR)) continue;
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
      res.setHeader('Content-Type', RESUME_SITE_MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    next();
  };
  return {
    name: 'studypilot-resume-site-mirror',
    configureServer(server) {
      server.middlewares.use(serveResumeSite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveResumeSite);
    },
  };
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), resumeSiteMirror()],
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
         * - motion-vendor：framer-motion 动效库（本项目最大的单一依赖）；
         * - three-vendor：仅由按需加载的 3D 视觉效果请求。
         * 仅按包名静态归类，无副作用，不改变运行时行为与动效观感。
         */
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('framer-motion')) return 'motion-vendor';
            if (id.includes('/three/')) return 'three-vendor';
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
