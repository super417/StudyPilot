import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import VineMap from '@/components/journey/VineMap';
import '@/components/journey/journey.css';
import type { TabKey } from '@/components/TabNav';
import { fetchJourney } from '@/journey/api';
import { isCompactViewport, remainingDays, spanDays, todayCta } from '@/journey/layout';
import { buildJourneyDemo } from '@/journey/mock';
import { isJourneyDemo } from '@/journey/route';
import type { JourneyResponse } from '@/journey/types';
import { addDaysISO, todayISO } from '@/lib/dates';
import { ApiError } from '@/lib/httpClient';
import { requestPracticeBoard } from '@/lib/practiceApi';

export interface JourneyPageProps {
  onBack: () => void;
  onNavigate: (tab: TabKey) => void;
}

function JourneyPage({ onBack, onNavigate }: JourneyPageProps) {
  const demo = isJourneyDemo();
  const [data, setData] = useState<JourneyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requested = useRef(new Set<string>());
  const [box, setBox] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

  useEffect(() => {
    const onResize = () => setBox({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (demo) {
      setData(buildJourneyDemo());
      return undefined;
    }
    const today = todayISO();
    let cancelled = false;
    fetchJourney({ today, from: addDaysISO(today, -60), to: addDaysISO(today, 60) })
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof ApiError ? reason.message : '航图加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [demo]);

  const days = useMemo(() => (data ? spanDays(data) : []), [data]);
  const loadAround = useCallback(
    (date: string) => {
      if (demo || !data?.plan || requested.current.has(date)) return;
      requested.current.add(date);
      const rawFrom = addDaysISO(date, -30);
      const rawTo = addDaysISO(date, 30);
      const from = rawFrom < data.plan.startDate ? data.plan.startDate : rawFrom;
      const to = rawTo > data.plan.goalDate ? data.plan.goalDate : rawTo;
      fetchJourney({ today: data.today, from, to })
        .then((response) => {
          setData((current) => {
            if (!current) return response;
            const merged = new Map(current.days.map((day) => [day.date, day]));
            for (const day of response.days) merged.set(day.date, day);
            return { ...current, days: [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)) };
          });
        })
        .catch(() => {
          requested.current.delete(date);
        });
    },
    [data, demo],
  );
  const todayDay = days.find((day) => day.date === data?.today);
  const cta = todayCta(todayDay);
  const compact = isCompactViewport(box.w, box.h);

  const openRoadmap = () => onNavigate('roadmap');
  const openPractice = () => {
    requestPracticeBoard('today');
    onNavigate('mistakes');
  };

  return (
    <div className="journey-root relative h-[100dvh] overflow-hidden" data-scene="map">
      <div className="journey-sky-clouds pointer-events-none absolute inset-0" />
      {error ? (
        <div className="grid h-full place-items-center p-6 text-center">
          <div className="journey-card max-w-sm p-6">
            <p className="text-sm text-[#14532d]">{error}</p>
            <button type="button" className="journey-pill mt-4 px-4 py-2 text-sm font-bold" onClick={onBack}>
              返回
            </button>
          </div>
        </div>
      ) : !data ? (
        <div className="grid h-full place-items-center text-sm font-semibold text-[#14532d]">正在铺开星藤…</div>
      ) : !data.plan ? (
        <div className="grid h-full place-items-center p-6 text-center">
          <div className="journey-card max-w-sm p-6">
            <p className="text-base font-bold text-[#14532d]">还没有学习计划</p>
            <p className="mt-2 text-sm text-[#3f6b4a]">排好计划之后，这里会按每一天长出果实。</p>
            <button type="button" className="journey-pill mt-4 px-4 py-2 text-sm font-bold" onClick={openRoadmap}>
              去 Roadmap
            </button>
          </div>
        </div>
      ) : (
        <VineMap
          days={days}
          phases={data.phases}
          today={data.today}
          goalName={data.plan.goalName}
          compact={compact}
          onSelect={() => undefined}
          onBoss={openPractice}
          onNeed={loadAround}
        />
      )}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto journey-chip max-w-[60%] px-3 py-2 text-xs font-bold leading-5">
          <div className="truncate">{data?.plan?.goalName ?? '星藤航图'}</div>
          {data?.plan ? <div>剩余 {remainingDays(data.plan.goalDate, data.today)} 天</div> : null}
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          {data?.summary ? (
            <div className="journey-chip hidden px-3 py-2 text-xs font-bold sm:block">
              本周 {data.summary.weekStars} ★ · 连续 {data.summary.streakDays} 天
            </div>
          ) : null}
          <button type="button" className="journey-chip px-3 py-2 text-xs font-bold" onClick={onBack}>
            返回
          </button>
        </div>
      </header>
      {data?.plan ? (
        <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <button type="button" className="journey-pill pointer-events-auto mx-auto block w-full max-w-md px-4 py-2" onClick={openRoadmap}>
            <span className="block text-lg font-black tracking-wide">{cta.title}</span>
            <span className="block text-xs font-semibold opacity-90">{cta.subtitle}</span>
          </button>
        </footer>
      ) : null}
    </div>
  );
}

export default JourneyPage;
