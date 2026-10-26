/**
 * StudyPilot：给镜像的简历编辑器补两件事
 * 1) 「注意：建议在设置里配置简历备份文件夹…」提示卡左侧加一个可关闭的 ×；
 *    静止时是一条短横线，**鼠标悬停时**由横线「组成」成 ×，移开再收回（morphicons 弹簧动效）；
 * 2) 关闭只在本次进入有效——不写任何持久化，刷新/下次进入会重新出现。
 *
 * 该页面是第三方打包产物（React 编译后），所以走原生 DOM + Web Component，
 * 动效复用主应用同一个 morphicons（同一套 path 与 spring 参数）。
 */
import { defineMorphIcon } from './morphicons/element.js';

defineMorphIcon();

const MINUS_D = 'M5 12h14';
const X_D = 'M18 6 6 18M6 6l12 12';
// 卡片文案会被 finalize_mirror 改写，标记要跟着认：旧文案「…配置简历备份文件夹…」→ 新文案「内容已随账号同步…」
const NOTICE_MARKS = ['可放心清缓存', '备份文件夹', 'safe to clear the browser cache'];
const SCAN_DELAY_MS = 120;

let scanTimer = 0;

function createCloseButton(onClose) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sp-notice-close';
  button.setAttribute('aria-label', '关闭提示');
  button.title = '关闭提示';

  const icon = document.createElement('morph-icon');
  // 静止态是横线；换 .icon 即补间，等价于 React 的 <MorphIcon icon={hovered ? X : Minus} />
  icon.setAttribute('icon', MINUS_D);
  icon.setAttribute('size', '14');
  icon.setAttribute('stroke-width', '2.25');
  icon.setAttribute('spring', 'snappy');
  icon.setAttribute('reduced-motion', 'never');
  button.appendChild(icon);

  // 悬停才动：进入时横线张开成 ×，移开收回横线；键盘聚焦同样触发
  button.addEventListener('pointerenter', () => {
    icon.icon = X_D;
  });
  button.addEventListener('pointerleave', () => {
    icon.icon = MINUS_D;
  });
  button.addEventListener('focus', () => {
    icon.icon = X_D;
  });
  button.addEventListener('blur', () => {
    icon.icon = MINUS_D;
  });

  button.addEventListener('click', onClose);

  return button;
}

function enhance(card) {
  if (!card || card.dataset.spNotice === '1') return;
  card.dataset.spNotice = '1';
  card.insertBefore(
    createCloseButton(() => {
      // 两段式：先淡出（CSS 过渡），过渡结束再 display:none，避免卡片瞬间消失显得生硬
      card.dataset.spClosing = '1';
      window.setTimeout(() => {
        card.dataset.spClosed = '1';
        delete card.dataset.spClosing;
      }, 180);
    }),
    card.firstChild,
  );
}

function scan() {
  scanTimer = 0;
  const alerts = document.querySelectorAll('div[role="alert"]:not([data-sp-notice])');
  alerts.forEach((card) => {
    const text = card.textContent || '';
    if (NOTICE_MARKS.some((mark) => text.includes(mark))) enhance(card);
  });
}

function scheduleScan() {
  if (scanTimer) return;
  scanTimer = window.setTimeout(scan, SCAN_DELAY_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scheduleScan, { once: true });
} else {
  scheduleScan();
}

new MutationObserver(scheduleScan).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
