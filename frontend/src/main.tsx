import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { warmRiveAssets } from './lib/riveWarmup';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root not found');
}

// 总览页是登录后的默认落地页。App 里用 lazy() 加载它，但 lazy 要等 React 挂载后
// 才发起 import，白白多一个 RTT。这里在入口执行时立即预热同一个 chunk，
// 下载与 React 初始化并行；lazy() 会复用这次 import 的 promise。
void import('./pages/OverviewPage');

// 学习流程那段的 Rive 资源（约 1.5MB）默认要等该段接近视口才下载，
// 首屏之后趁空闲先拉下来，滚动到那里时才有东西可画。
warmRiveAssets();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
