/**
 * 总览页「学习流程」段的水彩动画由 Rive 绘制：`rive.wasm` 880KB + `mailerbot-heros.riv`
 * 602KB（均为 gzip 后）。`PostcardsRoute` 要等该段进入视口前 800px 才发请求，服务器
 * 上行约 0.5MB/s，用户滚到那里时还要再等约 3 秒才看得到。
 *
 * 这里在首屏之后的空闲时间提前拉一遍：命中 HTTP 缓存（`/postcards/` 缓存 30 天），
 * Rive 自己那次请求直接复用。必须把 body 读完，否则浏览器不会落缓存。
 * 这两份只是装饰资源，失败静默忽略，不影响可用性。
 */
const RIVE_ASSETS = [
  '/postcards/animation/rive.wasm',
  '/postcards/animation/mailerbot-heros.riv',
];

export function warmRiveAssets(): void {
  const run = () => {
    for (const url of RIVE_ASSETS) {
      void fetch(url, { cache: 'force-cache' })
        .then((res) => (res.ok ? res.arrayBuffer() : null))
        .catch(() => undefined);
    }
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 2500 });
  } else {
    setTimeout(run, 1200);
  }
}
