import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import profileBg from '@/assets/profile-bg.jpg';
import AuthPage from '@/components/auth/AuthPage';
import Header from '@/components/Header';
import TabNav, { type TabKey } from '@/components/TabNav';
import { ScrollProgressBar } from '@/components/motion';
import { AssistantWidget } from '@/components/assistant';
import OverviewPage from '@/pages/OverviewPage';
import RoadmapPage from '@/pages/RoadmapPage';
import MistakeBookPage from '@/pages/MistakeBookPage';
import StatisticsPage from '@/pages/StatisticsPage';
import ResumeSelectorPage from '@/pages/ResumeSelectorPage';
import PracticalResumePage from '@/pages/PracticalResumePage';
import ProfilePage from '@/pages/ProfilePage';
import MainframePage from '@/pages/MainframePage';
import StudyPilotHero from '@/components/StudyPilotHero';
import StudyPilotJourney from '@/components/StudyPilotJourney';
import {
  closeMainframePage,
  isMainframeRoute,
} from '@/lib/mainframeRoute';
import { useAuthStore } from '@/store/authStore';

const PersonalWebsiteResume = lazy(() => import('@/pages/PersonalWebsiteResume'));

/** activeTab → 对应页面组件的映射（页面容器路由） */
const PAGES: Record<TabKey, ComponentType> = {
  overview: OverviewPage,
  roadmap: RoadmapPage,
  mistakes: MistakeBookPage,
  weekly: StatisticsPage,
  resume: PersonalWebsiteResume,
  profile: ProfilePage,
};

type ResumeRoute = '/resume' | '/resume/practical' | '/resume/interactive' | null;

function currentResumeRoute(): ResumeRoute {
  const path = window.location.hash.slice(1).replace(/\/$/, '');
  return path === '/resume' || path === '/resume/practical' || path === '/resume/interactive'
    ? path
    : null;
}

/**
 * 个人中心整屏背景：雪山图 + 极淡明暗叠加层 + 兜底渐变。
 *
 * 为什么画在 App 外壳上，而不是 ProfilePage 内部：
 * 外壳 div 是非定位块级元素，其背景在根层叠上下文的最底层（绘制步骤 3）绘制，
 * 天然位于所有卡片之下，也无需任何 z-index 技巧。
 * 若改由页面内部用一个 `fixed` + 负 z-index 的层来画，会按 CSS 绘制顺序
 * （负 z-index 定位层在步骤 2，早于非定位块级后代的背景）被外壳的不透明渐变
 * 盖住；只在页面过渡动画期间可见（motion.div 临时带 transform 而形成层叠
 * 上下文，把背景层拉进子树绘制），动画结束 transform 归零后即被遮住 ——
 * 表现为「刷新闪一下就不见了」。
 *
 * 图层自下而上：兜底渐变 → 雪山图 → 明暗叠加；图片缺失时只见兜底渐变，页面不崩。
 */
const PROFILE_BACKDROP: CSSProperties = {
  backgroundImage: `linear-gradient(rgba(255,255,255,0.06), rgba(20,40,60,0.16)), url(${profileBg}), linear-gradient(135deg, #dbe6ef, #c7d6e4, #aebfce)`,
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundAttachment: 'fixed',
};

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>(() => currentResumeRoute() ? 'resume' : 'overview');
  const [showMainframe, setShowMainframe] = useState(() => isMainframeRoute());
  const [resumeRoute, setResumeRoute] = useState<ResumeRoute>(() => currentResumeRoute());
  const [heroOverlap, setHeroOverlap] = useState(156);
  const topbarRef = useRef<HTMLDivElement>(null);
  const { status, error, checkSession, logout } = useAuthStore();
  const CurrentPage = PAGES[activeTab];

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  useEffect(() => {
    const sync = () => {
      setShowMainframe(isMainframeRoute());
      const route = currentResumeRoute();
      setResumeRoute(route);
      if (route) setActiveTab('resume');
    };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useLayoutEffect(() => {
    const topbar = topbarRef.current;
    if (!topbar) return;
    const update = () => {
      const documentTop = topbar.getBoundingClientRect().top + window.scrollY;
      setHeroOverlap(documentTop + topbar.offsetHeight + 24);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(topbar);
    return () => observer.disconnect();
  }, [status, activeTab, showMainframe, resumeRoute]);

  const openResumeRoute = (route: Exclude<ResumeRoute, null>) => {
    setActiveTab('resume');
    setResumeRoute(route);
    window.location.hash = route;
  };

  const changeTab = (tab: TabKey) => {
    if (tab === 'resume') {
      openResumeRoute('/resume');
      return;
    }
    setActiveTab(tab);
    setResumeRoute(null);
    if (currentResumeRoute()) window.location.hash = '';
    if (tab === 'overview') {
      window.requestAnimationFrame(() => {
        window.scrollTo({
          top: 0,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        });
      });
    }
  };

  if (status === 'checking') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F7FAF8] p-6 text-brandDark">
        <div className="rounded-full bg-white px-5 py-3 text-sm shadow-card">正在检查登录状态…</div>
      </main>
    );
  }

  if (status === 'unauthenticated') return <AuthPage />;

  /**
   * 演示首屏现在走登录态：未登录访问 `#/mainframe` 会先落到 AuthPage，
   * 登录成功后才渲染本页（hash 不会被清掉，所以登录后自动回到这里）。
   *
   * 它必须排在上面的鉴权判断**之后** —— 本页的聊天框打真实 SSE、会话落本地，
   * 无鉴权时打开只会拿到一串 401。
   */
  if (showMainframe) {
    // 演示首屏的导航要真的能进主应用：先清 hash 关掉本页，再切板块。
    // 两步必须在同一个回调里 —— 分开写会先闪一下主应用默认板块再跳。
    return (
      <MainframePage
        onBack={closeMainframePage}
        onNavigate={(tab) => {
          closeMainframePage();
          changeTab(tab);
        }}
      />
    );
  }

  if (resumeRoute === '/resume/practical') {
    return <PracticalResumePage onBack={() => openResumeRoute('/resume')} />;
  }

  if (resumeRoute === '/resume/interactive') {
    return (
      <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-[#0c0c0c] text-sm text-white">正在载入个人网站简历…</main>}>
        <PersonalWebsiteResume onBack={() => openResumeRoute('/resume')} />
      </Suspense>
    );
  }

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-[#EAF2EC] to-[#FDFEFE] p-4 sm:p-6"
      style={activeTab === 'profile' ? PROFILE_BACKDROP : undefined}
    >
      <ScrollProgressBar />
      <div className="mx-auto max-w-6xl space-y-6">
        {error && (
          <div role="alert" className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm">
            {error}
          </div>
        )}
        {/*
          页头 + Tab 导航作为一组：组内间距 12px（比外层 space-y-6 的 24px 紧），
          让"标题区 → 导航"读成一个整体；与下方内容区仍保持 24px 的分隔。
        */}
        <div ref={topbarRef} className={`app-shared-topbar space-y-3 ${activeTab === 'overview' ? 'sp-hero-topbar' : ''}`}>
          <Header onLogout={() => void logout()} />
          <TabNav activeTab={activeTab} onChange={changeTab} />
        </div>
        <main>
          {/* 旧页面退出时退出布局，避免把新总览首屏向下挤；总览背景首帧即绘制。 */}
          <AnimatePresence mode="popLayout">
            <motion.div
              key={activeTab}
              initial={activeTab === 'overview' ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
            >
              {activeTab === 'resume' ? (
                <ResumeSelectorPage onBack={() => changeTab('overview')} onSelect={openResumeRoute} />
              ) : activeTab === 'profile' ? (
                <ProfilePage onNavigate={changeTab} />
              ) : activeTab === 'overview' ? (
                <>
                  <StudyPilotHero onNavigate={changeTab} overlap={heroOverlap} />
                  <StudyPilotJourney />
                  <div id="overview-content" className="spj-overview-bridge scroll-mt-6">
                    <OverviewPage onNavigate={changeTab} />
                  </div>
                </>
              ) : activeTab === 'weekly' ? (
                <StatisticsPage onNavigate={changeTab} />
              ) : (
                <CurrentPage />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <AssistantWidget overviewEntrance={activeTab === 'overview'} />
    </div>
  );
}

export default App;
