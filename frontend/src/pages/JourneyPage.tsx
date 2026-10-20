import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EntranceTree, type EntranceFruit } from '@/components/journey/EntranceTree';
import GlassCta from '@/components/journey/GlassCta';
import { CheerCard, DayDrawer } from '@/components/journey/Feedback';
import VineMap from '@/components/journey/VineMap';
import '@/components/journey/journey.css';
import type { TabKey } from '@/components/TabNav';
import { fetchJourney, fetchJourneyCheer, fetchJourneyTasks } from '@/journey/api';
import { cheerCapText, localCheer } from '@/journey/cheer';
import {
  blankCheerCount,
  markAutoCheerShown,
  readStoredStars,
  rememberAutoRule,
  rememberCheerRule,
  usedCheerRules,
  wasAutoCheerShown,
  writeStoredStars,
} from '@/journey/cheerStore';
import { isCompactViewport, remainingDays, spanDays, todayCta } from '@/journey/layout';
import { buildJourneyDemo, demoTasks } from '@/journey/mock';
import { isJourneyDemo } from '@/journey/route';
import type { CheerResponse, JourneyDay, JourneyResponse, JourneyTask } from '@/journey/types';
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
  const armed = useRef(false);
  const lastBlank = useRef(0);
  const cheerSource = useRef<'auto' | 'blank' | 'other'>('other');
  const [box, setBox] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [selected, setSelected] = useState<JourneyDay | null>(null);
  const [tasks, setTasks] = useState<JourneyTask[]>([]);
  const [cheer, setCheer] = useState<CheerResponse | null>(null);
  const [dayCheer, setDayCheer] = useState<CheerResponse | null>(null);
  const [scene, setScene] = useState<'entrance' | 'leaving' | 'map'>('entrance');
  const [celebrate, setCelebrate] = useState(false);
  const leaveTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return undefined;
    const previous = meta.getAttribute('content') ?? '';
    if (previous.includes('viewport-fit=cover')) return undefined;
    meta.setAttribute('content', `${previous}, viewport-fit=cover`);
    return () => meta.setAttribute('content', previous);
  }, []);

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
  const remainLabel = data?.plan ? `剩余 ${remainingDays(data.plan.goalDate, data.today)} 天` : null;
  const weekLabel = data?.summary ? `本周 ${data.summary.weekStars} ★` : null;
  const streakLabel = data?.summary ? `连续 ${data.summary.streakDays} 天` : null;

  const openRoadmap = () => onNavigate('roadmap');
  const openPractice = () => {
    requestPracticeBoard('today');
    onNavigate('mistakes');
  };

  const showWeek = useCallback(
    async (exclude: string[]): Promise<CheerResponse | undefined> => {
      if (!data) return undefined;
      const next = demo
        ? localCheer(data, 'week', undefined, exclude)
        : await fetchJourneyCheer({ today: data.today, scope: 'week', exclude }).catch(() =>
            localCheer(data, 'week', undefined, exclude),
          );
      setCheer(next);
      return next;
    },
    [data, demo],
  );

  useEffect(() => {
    if (scene !== 'map' || !data?.plan || armed.current) return undefined;
    armed.current = true;
    const today = data.today;
    const stars = data.days.find((day) => day.date === today)?.stars;
    const previous = readStoredStars(today);
    if (stars !== null && stars !== undefined) {
      if (previous !== null && stars > previous) {
        setCelebrate(true);
        setCheer({ ruleId: 'star', text: `第 ${stars} 颗星点亮！`, facts: { stars }, source: 'template' });
        writeStoredStars(today, stars);
        markAutoCheerShown(today);
        return undefined;
      }
      writeStoredStars(today, stars);
    }
    if (wasAutoCheerShown(today)) return undefined;
    const timer = window.setTimeout(() => {
      markAutoCheerShown(today);
      cheerSource.current = 'auto';
      void showWeek(usedCheerRules(today));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [data, scene, showWeek]);

  useEffect(() => {
    if (!data || !cheer || cheerSource.current !== 'auto') return;
    if (cheer.ruleId === 'cap' || cheer.ruleId === 'star' || cheer.ruleId === 'day') return;
    rememberAutoRule(data.today, cheer.ruleId);
    cheerSource.current = 'other';
  }, [cheer, data]);

  useEffect(() => {
    if (!selected || !data) return undefined;
    let cancelled = false;
    const apply = (nextTasks: JourneyTask[], nextCheer: CheerResponse) => {
      if (!cancelled) {
        setTasks(nextTasks);
        setDayCheer(nextCheer);
      }
    };
    if (demo) {
      apply(demoTasks(selected.date), localCheer(data, 'day', selected.date, []));
      return () => {
        cancelled = true;
      };
    }
    Promise.all([
      fetchJourneyTasks(selected.date).catch(() => []),
      fetchJourneyCheer({ today: data.today, scope: 'day', date: selected.date }).catch(() =>
        localCheer(data, 'day', selected.date, []),
      ),
    ]).then(([nextTasks, nextCheer]) => apply(nextTasks, nextCheer));
    return () => {
      cancelled = true;
    };
  }, [data, demo, selected]);

  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const entranceFruits = useMemo<EntranceFruit[]>(() => {
    if (!data) return [];
    return days
      .filter((day) => day.date <= data.today && day.loaded !== false)
      .slice(-7)
      .map((day) => ({
        date: day.date,
        color: day.starColor,
        kind: day.total > 0 && day.state !== 'empty' ? 'fruit' : 'sprout',
        cleared: day.rate === 100 && day.stars === 4,
      }));
  }, [data, days]);

  const begin = () => {
    if (scene !== 'entrance') return;
    if (!data) return;
    if (!data.plan || error) {
      setScene('map');
      return;
    }
    if (reducedMotion) {
      setScene('map');
      return;
    }
    setScene('leaving');
    leaveTimer.current = window.setTimeout(() => {
      setScene('map');
    }, 900);
  };

  const onBlank = () => {
    if (!data) return;
    const now = Date.now();
    if (now - lastBlank.current < 3000) return;
    lastBlank.current = now;
    if (blankCheerCount(data.today) >= 5) {
      cheerSource.current = 'other';
      setCheer({ ruleId: 'cap', text: cheerCapText(), facts: {}, source: 'template' });
      return;
    }
    const exclude = usedCheerRules(data.today);
    cheerSource.current = 'blank';
    void showWeek(exclude).then((shown) => {
      if (!shown || shown.ruleId === 'cap' || shown.ruleId === 'star') return;
      rememberCheerRule(data.today, shown.ruleId);
    });
  };

  return (
    <div className="journey-root relative h-[100dvh] overflow-hidden" data-scene={scene === 'map' ? 'map' : 'entrance'} data-compact={compact ? '1' : '0'}>
      {scene !== 'entrance' ? (
        <>
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
          onSelect={(day) => {
            setCheer(null);
            setSelected(day);
          }}
          onBoss={openPractice}
          onNeed={loadAround}
          onBlank={onBlank}
          celebrate={celebrate}
        />
      )}
      {scene === 'map' ? (
      <>
      <header className="journey-map-bar pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-center px-3 pt-2">
        {remainLabel && weekLabel && streakLabel ? (
          <div className="journey-glass-radio pointer-events-auto">
            <input type="radio" name="journey-status" id="journey-status-remain" defaultChecked />
            <label htmlFor="journey-status-remain">{remainLabel}</label>
            <input
              type="radio"
              name="journey-status"
              id="journey-status-week"
              onChange={() => document.querySelector<HTMLButtonElement>('[data-return="today"]')?.click()}
            />
            <label htmlFor="journey-status-week">{weekLabel}</label>
            <input type="radio" name="journey-status" id="journey-status-streak" />
            <label htmlFor="journey-status-streak">{streakLabel}</label>
            <div className="journey-glass-glider" />
          </div>
        ) : (
          <div className="journey-glass-radio">
            <span className="flex flex-1 items-center justify-center px-4 py-2 text-sm font-black text-white">星藤航图</span>
          </div>
        )}
        <button type="button" className="journey-chip pointer-events-auto absolute right-3 top-3 px-3 py-2 text-xs font-bold" onClick={onBack}>
          返回
        </button>
      </header>
      {data?.plan ? (
        <footer className="journey-map-footer pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center px-3 pb-[max(8px,env(safe-area-inset-bottom))]">
          <GlassCta label={cta.title} onClick={openRoadmap} />
          <p className="pointer-events-none mt-1 text-center text-xs font-bold text-[#14321c] [text-shadow:0_1px_0_rgba(255,255,255,0.85)]">
            {cta.subtitle}
          </p>
        </footer>
      ) : null}
      {cheer && !selected ? <CheerCard cheer={cheer} onClose={() => setCheer(null)} /> : null}
      {selected && data?.plan ? (
        <DayDrawer
          day={selected}
          planStart={data.plan.startDate}
          tasks={tasks}
          cheer={dayCheer}
          compact={compact}
          onClose={() => {
            setSelected(null);
            setTasks([]);
            setDayCheer(null);
          }}
          onPractice={openPractice}
          onRoadmap={openRoadmap}
        />
      ) : null}
      </>
      ) : null}
      </>
      ) : null}
      {scene !== 'map' ? (
        <EntranceTree
          streakDays={data?.summary.streakDays ?? null}
          weekStars={data?.summary.weekStars ?? null}
          fruits={entranceFruits}
          compact={compact}
          leaving={scene === 'leaving'}
          reducedMotion={reducedMotion}
          onStart={begin}
          onBack={onBack}
        />
      ) : null}
    </div>
  );
}

export default JourneyPage;
