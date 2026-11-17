import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root not found');
}

// 总览页是登录后的默认落地页。App 里用 lazy() 加载它，但 lazy 要等 React 挂载后
// 才发起 import，白白多一个 RTT。这里在入口执行时立即预热同一个 chunk，
// 下载与 React 初始化并行；lazy() 会复用这次 import 的 promise。
void import('./pages/OverviewPage');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
