/**
 * RoadmapHeader — Roadmap 页顶部标题区（需求 5.1 / 12.10）
 *
 * 纯静态 UI：左侧固定 UI 文案标题「全线阶段路线图」+ 副标；
 * 右上角展示最近更新时间戳（来自 Plan.updatedAt，格式化为 YYYY-MM-DD HH:mm）。
 * 无任何动效。
 */

export interface RoadmapHeaderProps {
  /** 最近更新时间戳（ISO 字符串，来自 getMockPlan().updatedAt） */
  updatedAt: string;
}

/** 把 ISO 时间戳格式化为本地 YYYY-MM-DD HH:mm 展示。 */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${date} ${time}`;
}

function RoadmapHeader({ updatedAt }: RoadmapHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1
          className="text-gradient font-black leading-none tracking-tight"
          style={{ fontSize: 'clamp(2rem, 5vw, 64px)' }}
        >
          全线阶段路线图
        </h1>
        <p className="mt-3 text-base text-gray-500">你的路线，正在跟着你变化</p>
      </div>

      <div className="shrink-0 text-left sm:text-right">
        <p className="text-xs font-medium text-gray-400">最近更新</p>
        <p className="mt-1 font-display text-sm font-semibold text-brandDark">
          {formatTimestamp(updatedAt)}
        </p>
      </div>
    </header>
  );
}

export default RoadmapHeader;
