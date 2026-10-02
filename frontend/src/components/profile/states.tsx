import type { ReactNode } from 'react';

/** 卡片内 loading 骨架：几条脉冲占位条。 */
export function CardLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-4 animate-pulse rounded-full bg-brandFaint/70"
          style={{ width: `${90 - index * 12}%` }}
        />
      ))}
      <span className="sr-only">加载中</span>
    </div>
  );
}

/** 卡片内错误态：提示 + 可选重试。 */
export function CardError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl bg-danger px-4 py-3 text-sm text-dangerText" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-dangerText transition hover:bg-white/80"
        >
          重试
        </button>
      ) : null}
    </div>
  );
}

/** 卡片内空态。 */
export function CardEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-bg px-4 py-8 text-center text-sm text-gray-400">
      {children}
    </div>
  );
}
