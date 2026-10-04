import type { MasteryDetailItem } from '@/mocks/types';

export interface MasteryOverviewCardProps {
  avg: number;
  items: MasteryDetailItem[];
}

/** 白色「知识掌握度」卡：数据来自最新周报 masteryDetail。 */
function MasteryOverviewCard({ avg, items }: MasteryOverviewCardProps) {
  const safeAvg = Math.max(0, Math.min(100, Math.round(avg)));

  return (
    <section className="flex h-full flex-col rounded-[28px] border border-brandFaint bg-card p-6 sm:p-7">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-gray-400">MASTERY</p>
          <h3 className="mt-1 font-display text-2xl font-bold text-brandDark">知识掌握度（平均）</h3>
        </div>
        <p className="font-display text-4xl font-bold text-brandDark">{safeAvg}%</p>
      </div>

      {items.length === 0 ? (
        <p className="mt-8 flex-1 text-sm text-gray-400">
          在个人中心添加课程后，这里按该科目本周任务的完成比例显示。
        </p>
      ) : (
        <ul className="mt-6 flex flex-1 flex-col gap-4">
          {items.map((item) => {
            const value = Math.max(0, Math.min(100, item.percent));
            return (
              <li key={item.subject}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-brandDark">{item.subject}</span>
                  <span className="text-xs font-semibold text-purple">{value}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-brandFaint">
                  <div className="h-full rounded-full bg-purple" style={{ width: `${value}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 text-xs leading-relaxed text-gray-400">
        不是看完就算会。掌握度来自复述、练习和隔日回馈。
      </p>
    </section>
  );
}

export default MasteryOverviewCard;
