import type { MasteryDetailItem } from '@/mocks/types';
import { FadeIn, InteractiveCard } from '@/components/motion';

/**
 * MasteryDetail — 本周复盘知识掌握明细（需求 7.4）
 *
 * 纯静态内容：遍历 masteryDetail，每个科目一行——科目名 + 静态百分比进度条
 * （进度用紫色 #8B5CF6，底槽 brandFaint）+ 百分比数字。进度条宽度按 percent
 * 静态设置，内部内容无动效。
 *
 * 动效分层：外层 FadeIn 只做入场（上移 20px 淡入），内层 InteractiveCard
 * 承载 .card 卡片样式并提供克制的 hover 上浮/放大/阴影加深 + tap 回弹。
 * 两层 transform 互不干扰，进度条与配色保持不变。
 */

export interface MasteryDetailProps {
  /** 各科目掌握度明细 */
  items: MasteryDetailItem[];
}

function MasteryDetail({ items }: MasteryDetailProps) {
  return (
    <FadeIn y={20}>
      <InteractiveCard className="card p-6 sm:p-8">
        <h2 className="font-display text-lg font-bold text-brandDark">知识掌握明细</h2>
        <p className="mt-1 text-sm text-gray-400">各科目掌握度，会随每周复盘更新</p>

        <ul className="mt-6 flex flex-col gap-5">
          {items.map((item) => {
            const value = Math.max(0, Math.min(100, item.percent));
            return (
              // 视口内渲染优化（需求 18.28）：掌握度明细随科目/知识点增长可能变长，
              // cv-list 跳过屏外行的布局/绘制；每行约 56px 占位估算防滚动跳动。
              <li
                key={item.subject}
                className="cv-list"
                style={{ containIntrinsicSize: 'auto 56px' }}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium text-brandDark">{item.subject}</span>
                  <span className="font-display text-sm font-semibold text-purple">{value}%</span>
                </div>
                <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-brandFaint">
                  <div
                    className="h-full rounded-full bg-purple"
                    style={{ width: `${value}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </InteractiveCard>
    </FadeIn>
  );
}

export default MasteryDetail;
