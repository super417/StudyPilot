/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端 API 根地址；留空则用相对路径（开发走 Vite proxy，生产需同域反代） */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Vite 默认支持静态资源导入，此声明为 TS 提供 .jpg 模块类型兜底。
declare module '*.jpg' {
  const src: string;
  export default src;
}
