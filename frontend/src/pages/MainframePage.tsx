import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTypewriter } from '@/hooks/useTypewriter';
import NoticeCard from '@/components/mainframe/NoticeCard';
import WorkflowDemo from '@/components/mainframe/WorkflowDemo';
import ChatPanel from '@/components/chat/ChatPanel';
import SessionList from '@/components/chat/SessionList';
import type { TabKey } from '@/components/TabNav';
import {
  FALLBACK_CITATIONS,
  FALLBACK_SNAPSHOT,
  formatHours,
  loadDemoCitations,
  loadDemoSnapshot,
  type DemoCitation,
  type DemoSnapshot,
} from '@/lib/mainframeDemo';
import { useAssistantStore, type AssistantContext } from '@/store';
import { isMainframeChatExpand } from '@/lib/mainframeRoute';
/**
 * 背景视频：人物（A.R.I.A）在红幕前从右向左转头，时间轴由鼠标横向位置驱动 ——
 * 视线因此跟随鼠标。必须是 H.264/avc1 8-bit 才能在浏览器里解出来：
 * 原始素材是 HEVC Main10（10-bit），Chrome / Edge / Firefox 都无法解码，
 * `<video>` 只会抛 error 并停在黑帧上，这就是「展开后一片黑」的根因。
 * 转码命令见 `scripts/transcode-mainframe-video.sh`。
 */
const VIDEO_SRC = `${import.meta.env.BASE_URL}mainframe-bg.mp4`;
/** 视频首帧静态海报，垫在视频下层：未就绪或解码失败时兜底，杜绝黑屏。 */
const POSTER_SRC = `${import.meta.env.BASE_URL}mainframe-poster.jpg`;
/**
 * 视线映射方向：**0s 时人物脸朝左，末帧脸朝右**，所以鼠标越靠右 → 进度越靠后。
 *
 * 这个方向不能靠肉眼判断 3/4 侧脸 —— 看过好几遍都读反了。可复现的量化判据是
 * 「鼻尖在头部包围盒内的相对横坐标」：0.685(0s) → 0.827(3.95s)，单调右移，
 * 说明脸在往右转。量测脚本见本文件底部的注释。
 */
/** 缓动基准系数；实际值在 step() 里按「距离目标的远近」自适应放大。 */
const FOLLOW_EASE = 0.18;
/** 24fps 的单帧时长，用作 seek 去抖阈值，避免每个 rAF 都写 currentTime。 */
const FRAME_SECONDS = 1 / 24;
/** 同一帧时长换算成毫秒，作为 seek 的时间节流下限（rAF 60Hz 而视频只有 24fps）。 */
const FRAME_MS = 1000 / 24;
const TYPEWRITER_TEXT = '既然来了，就聊聊。你现在复习到哪一步了？';

/**
 * 顶部导航：内容板块 + 个人中心；右侧独立「聊天记录」。
 * 与主应用 `TabNav` 的 label 保持一致，点进去能落到同名入口。
 */
interface NavLink {
  label: string;
  tab: TabKey;
}

const NAV_LINKS: readonly NavLink[] = [
  { label: '总览', tab: 'overview' },
  { label: 'Roadmap', tab: 'roadmap' },
  { label: '习题本', tab: 'mistakes' },
  { label: '本周复盘', tab: 'weekly' },
  { label: '个人中心', tab: 'profile' },
];

/**
 * 药丸按钮的行为。
 *
 * 「开始今天的学习」跳主应用总览；其余四个**全部留在本页**就地展开 ——
 * 聊天类的两个（说目标 / 聊两句）弹左侧毛玻璃聊天框，另两个弹演示浮层。
 * 不再跳回悬浮小窗：主人要的是「点聊天相关内容就在这个界面里聊」。
 */
type PillAction = 'goal' | 'overview' | 'chat' | 'workflow' | 'notice';

interface Pill {
  label: string;
  action: PillAction;
}

const PILLS: readonly Pill[] = [
  { label: '说出你的学习目标', action: 'goal' },
  { label: '开始今天的学习', action: 'overview' },
  { label: '和助手聊两句', action: 'chat' },
  { label: '看看它怎么工作', action: 'workflow' },
  { label: '收一条学习通知', action: 'notice' },
];

export interface MainframePageProps {
  onBack?: () => void;
  /** 切到主应用的某个板块（调用方负责同时关闭本页） */
  onNavigate?: (tab: TabKey) => void;
}

function MainframePage({ onBack, onNavigate }: MainframePageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pillsVisible, setPillsVisible] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  /** 左侧毛玻璃聊天框：仅小窗「展开」入口默认打开，普通 #/mainframe 仍是首屏。 */
  const [chatOpen, setChatOpen] = useState(() => isMainframeChatExpand());
  /** 右侧会话列表栏 */
  const [sessionsOpen, setSessionsOpen] = useState(false);
  /** 演示卡片上的数字：先用兜底值渲染，接口回来再替换 —— 首屏永远不会空白。 */
  const [snapshot, setSnapshot] = useState<DemoSnapshot>(FALLBACK_SNAPSHOT);
  const [citations, setCitations] = useState<DemoCitation[]>(FALLBACK_CITATIONS);
  const addMessage = useAssistantStore((s) => s.addMessage);
  const setContext = useAssistantStore((s) => s.setContext);
  const hydrate = useAssistantStore((s) => s.hydrate);
  const ensureConversation = useAssistantStore((s) => s.ensureConversation);
  const { displayed, done } = useTypewriter(TYPEWRITER_TEXT);

  useEffect(() => {
    const id = window.setTimeout(() => setPillsVisible(true), 400);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    void loadDemoSnapshot().then(setSnapshot);
    void loadDemoCitations().then(setCitations);
  }, []);

  /**
   * 进页面先把会话准备好（hydrate 拉历史 → ensure 兜底新建），但**不自动展开聊天框**：
   * 首屏永远先给大图 + 药丸按钮，点「和助手聊两句 / 说出你的学习目标」才弹面板。
   *
   * 从小窗展开进来时 store 里已经有当前会话和消息（含未完成的流式回复），
   * 再 hydrate 会把内存里的记录盖成库里的旧快照，所以有 activeId 就跳过。
   */
  useEffect(() => {
    void (async () => {
      try {
        if (isMainframeChatExpand() && useAssistantStore.getState().activeId) return;
        await hydrate();
        await ensureConversation();
      } catch {
        // 后端不可用（未登录 / 断网）不阻断首屏渲染，错误在真正发送时暴露
      }
    })();
  }, [hydrate, ensureConversation]);

  /**
   * Esc 的优先级：先关掉压在最上面的浮层，全关完了才退回主应用。
   * 反过来的话，演示面板开着按一下 Esc 会直接把人踢出这个页面，像崩溃。
   * 顺序 = z-index 从高到低：演示/站内信（z-50）→ 会话栏 / 聊天框（z-20）→ 手机菜单。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (demoOpen) {
        setDemoOpen(false);
        return;
      }
      if (noticeOpen) {
        setNoticeOpen(false);
        return;
      }
      if (sessionsOpen) {
        setSessionsOpen(false);
        return;
      }
      if (chatOpen) {
        setChatOpen(false);
        return;
      }
      if (menuOpen) {
        setMenuOpen(false);
        return;
      }
      onBack?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, demoOpen, noticeOpen, sessionsOpen, chatOpen, menuOpen]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let ready = false;
    let duration = 0;
    /** 鼠标归一化后的目标进度 0..1（0 = 首帧 = 脸朝左，1 = 末帧 = 脸朝右）。 */
    let target = 0.5;
    /** rAF 里逐帧向 target 靠拢的当前进度，避免鼠标抖动直接抖到画面上。 */
    let current = 0.5;
    let lastSeek = Number.NaN;
    let lastSeekAt = 0;
    let rafId = 0;

    const seekTo = (progress: number, force = false) => {
      if (duration <= 0) return;
      // 直接 seek 到 duration 会落在无帧区间，末帧留半帧余量。
      const time = Math.min(
        Math.max(progress, 0) * duration,
        Math.max(duration - FRAME_SECONDS / 2, 0),
      );
      // 门槛一：只在跨过「整整一帧」时才动时间轴。视频只有 24fps，比这更密的 seek
      // 不会多出任何画面，只会把解码器压住。
      if (Math.abs(time - lastSeek) < FRAME_SECONDS) return;
      // 门槛二：按时间节流。rAF 跑 60Hz 而视频只有 24fps，不拦的话会白白多出一倍
      // 以上的 seek —— 鼠标快速划过时正是它把画面拖卡。收尾那次（force）必须放行，
      // 否则画面会停在中间位置。
      const now = performance.now();
      if (!force && now - lastSeekAt < FRAME_MS * 0.9) return;
      lastSeek = time;
      lastSeekAt = now;
      try {
        // fastSeek 直接落到关键帧，比精确 seek 快一个量级；本片已编码成**全 I 帧**，
        // 「最近关键帧」就等于「目标帧」，精度不受影响。不支持时回退 currentTime。
        if (typeof video.fastSeek === 'function') video.fastSeek(time);
        else video.currentTime = time;
      } catch {
        /* 与元数据加载竞态，忽略 */
      }
    };

    const step = () => {
      rafId = 0;
      if (!ready) return;
      const delta = target - current;
      if (Math.abs(delta) < 0.0015) {
        current = target;
        seekTo(current, true);
        return;
      }
      // 自适应缓动：鼠标猛甩时一步跨掉大半，细挪时才慢速收敛。
      // 用固定系数（0.18）时快速移动要 20+ 帧才追上，那正是「卡顿」的观感来源。
      const ease = Math.min(0.55, FOLLOW_EASE + Math.abs(delta) * 1.2);
      current += delta * ease;
      seekTo(current);
      rafId = window.requestAnimationFrame(step);
    };

    /** 静止时不占用 rAF；只有目标变化才拉起追帧循环。 */
    const kick = () => {
      if (!rafId) rafId = window.requestAnimationFrame(step);
    };

    const onMove = (e: MouseEvent) => {
      target = e.clientX / window.innerWidth;
      kick();
    };

    /**
     * 先 muted play 一次再 pause：Chromium / WebKit 需要一次真实播放才会解锁解码器，
     * 否则后续 seek 只更新时间戳、不重绘画面 —— 表现为永远停在黑帧。
     */
    const unlock = async () => {
      if (cancelled || ready) return;
      duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      if (duration <= 0) return;
      try {
        video.muted = true;
        await video.play();
        if (cancelled) return;
        video.pause();
      } catch {
        /* 自动播放被策略拦截时 seek 通常仍可绘制，继续 */
      }
      if (cancelled) return;
      ready = true;
      lastSeek = Number.NaN;
      lastSeekAt = 0;
      seekTo(current, true);
      setVideoReady(true);
      // 补上「就绪之前」发生的鼠标移动：那时 kick() 拉起的 step 会在 !ready 处直接
      // return 且不再重新调度，target 已被更新但没人去追。这里重新拉起循环。
      kick();
    };

    const onMeta = () => {
      void unlock();
    };

    const onError = () => {
      if (cancelled) return;
      // 解不出来就退回海报层，不再让用户面对一块黑。
      console.warn('[Mainframe] 背景视频无法解码，已回退到静态海报。');
      setVideoReady(false);
    };

    // passive：监听器不调用 preventDefault，明确告知浏览器不必等它跑完再滚动/合成
    window.addEventListener('mousemove', onMove, { passive: true });
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('loadeddata', onMeta);
    video.addEventListener('canplay', onMeta);
    video.addEventListener('error', onError);
    if (video.readyState >= 1) void unlock();

    return () => {
      cancelled = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', onMove);
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('loadeddata', onMeta);
      video.removeEventListener('canplay', onMeta);
      video.removeEventListener('error', onError);
      video.pause();
    };
  }, []);

  /** 把这条站内信同步写进助手会话，评委回到主应用还能在聊天记录里再看到一次。 */
  const pushNoticeToAssistant = async () => {
    try {
      // 先确保有活动会话：`addMessage` 在没有 activeId 时会静默丢弃
      await ensureConversation();
    } catch {
      // 会话建不起来（未登录 / 断网）就只弹卡片，不让演示卡住
      return;
    }
    addMessage({
      id: `notice-${Date.now()}`,
      role: 'assistant',
      content: `本周复盘已生成：完成率 ${snapshot.completionRate}%，累计学习 ${formatHours(
        snapshot.totalMinutes,
      )} 小时，连续打卡 ${snapshot.streakDays} 天。`,
    });
  };

  /** 打开左侧聊天框；带 ctx 时顺便注入上下文（如「制定考研目标」）。 */
  const openChat = async (ctx?: AssistantContext) => {
    if (ctx) setContext(ctx);
    try {
      await ensureConversation();
    } catch {
      // 会话没建起来也让面板打开：至少能看到界面和错误，而不是「点了没反应」
    }
    setChatOpen(true);
  };

  const handlePill = (action: PillAction) => {
    switch (action) {
      case 'goal':
        void openChat({ type: 'plan', hint: '制定或调整考研复习规划' });
        break;
      case 'overview':
        onNavigate?.('overview');
        break;
      case 'chat':
        void openChat();
        break;
      case 'workflow':
        setDemoOpen(true);
        break;
      case 'notice':
        setNoticeOpen(true);
        void pushNoticeToAssistant();
        break;
    }
  };

  /**
   * 只有**左侧**聊天面板打开时才把文案淡出 —— 它整块压在人物脸上，文字留着就是噪点。
   *
   * 右侧「聊天记录」抽屉不算：它在屏幕另一半，把首屏一起抹掉会让左边空成一块绿，
   * 看起来像页面坏了。主人明确要求抽屉开着时左边保持原样。
   */
  const panelsOpen = chatOpen;

  return (
    <div className="mainframe-page relative min-h-screen overflow-hidden bg-[#050505] text-white">
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        {/* 海报层永远垫在最下面：视频未就绪或解码失败时也有画面，不会出现黑屏。 */}
        <img
          src={POSTER_SRC}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: '70% center' }}
        />
        <video
          ref={videoRef}
          src={VIDEO_SRC}
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
          style={{
            objectPosition: '70% center',
            opacity: videoReady ? 1 : 0,
          }}
        />
      </div>

      {menuOpen ? (
        <div
          className="fixed inset-0 z-[9] flex flex-col justify-center gap-8 bg-black/90 px-8 backdrop-blur-md md:hidden"
          aria-hidden={false}
        >
          {NAV_LINKS.map((link) => (
            <button
              key={link.tab}
              type="button"
              onClick={() => onNavigate?.(link.tab)}
              className="self-start text-left text-[30px] font-medium"
            >
              {link.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setSessionsOpen(true);
            }}
            className="self-start text-left text-[30px] font-medium underline underline-offset-2"
          >
            聊天记录
          </button>
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="mt-4 self-start text-left text-[18px] text-white/70 underline underline-offset-2"
            >
              Back to StudyPilot
            </button>
          ) : null}
        </div>
      ) : null}

      <nav className="fixed inset-x-0 top-0 z-10 px-5 pt-7 sm:px-8 sm:pt-9">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5 md:gap-6">
            <button
              type="button"
              onClick={onBack}
              className="flex shrink-0 items-center gap-3 text-left"
              aria-label={onBack ? '返回主应用' : 'StudyPilot'}
            >
              <span className="mainframe-logo text-[21px] tracking-tight text-white sm:text-[26px]">
                StudyPilot&reg;
              </span>
              <span
                className="select-none text-[25px] text-white sm:text-[30px]"
                style={{ letterSpacing: '-0.02em' }}
                aria-hidden="true"
              >
                ✳︎
              </span>
            </button>

            <div
              className="hidden min-w-0 items-center rounded-full border border-white/35 bg-white/15 px-1.5 py-1.5 text-[15px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-xl sm:text-[16px] md:flex md:gap-1"
              style={{ transform: 'translateX(156px)' }}
            >
              {NAV_LINKS.map((link) => (
                <button
                  key={link.tab}
                  type="button"
                  onClick={() => onNavigate?.(link.tab)}
                  className="whitespace-nowrap rounded-full px-3.5 py-1.5 transition-colors hover:bg-white/25 sm:px-4"
                >
                  {link.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSessionsOpen(true)}
            className="bookmarkBtn hidden shrink-0 md:flex"
            aria-label="聊天记录"
          >
            <span className="IconContainer">
              <svg viewBox="0 0 384 512" height="0.9em" className="icon" aria-hidden="true">
                <path d="M0 48V487.7C0 501.1 10.9 512 24.3 512c5 0 9.9-1.5 14-4.4L192 400 345.7 507.6c4.1 2.9 9 4.4 14 4.4c13.4 0 24.3-10.9 24.3-24.3V48c0-26.5-21.5-48-48-48H48C21.5 0 0 21.5 0 48z" />
              </svg>
            </span>
            <p className="text">聊天记录</p>
          </button>

          <button
            type="button"
            className="flex flex-col gap-[5px] md:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span
              className={`h-[2px] w-6 bg-white transition duration-300 ${
                menuOpen ? 'translate-y-[7px] rotate-45' : ''
              }`}
            />
            <span
              className={`h-[2px] w-6 bg-white transition duration-300 ${
                menuOpen ? 'opacity-0' : ''
              }`}
            />
            <span
              className={`h-[2px] w-6 bg-white transition duration-300 ${
                menuOpen ? '-translate-y-[7px] -rotate-45' : ''
              }`}
            />
          </button>
        </div>
      </nav>

      <section className="relative z-[1] flex h-screen flex-col justify-end overflow-hidden px-5 pb-12 sm:px-8 md:justify-center md:px-10 md:pb-0">
        {/*
          面板打开时整块淡出并上移：不做 unmount 是因为打字机状态在 hooks 里，
          卸载会重跑一遍打字动画，下次打开文字会「重新打一遍」。
        */}
        <motion.div
          className="relative z-10 max-w-xl"
          animate={{ opacity: panelsOpen ? 0 : 1, y: panelsOpen ? -12 : 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          style={{ pointerEvents: panelsOpen ? 'none' : undefined }}
        >
          <p
            className="pointer-events-none mb-5 select-none text-white sm:mb-6"
            style={{
              fontSize: 'clamp(18px, 4vw, 26px)',
              lineHeight: 1.3,
              fontWeight: 400,
              filter: 'blur(4px)',
            }}
          >
            认识一下 A.R.I.A，
            <br />
            StudyPilot 的自适应学习助手
          </p>

          <p
            className="mb-5 text-white sm:mb-6"
            style={{
              fontSize: 'clamp(18px, 4vw, 26px)',
              lineHeight: 1.35,
              fontWeight: 400,
              minHeight: 54,
            }}
          >
            {displayed}
            {!done ? (
              <span
                className="mainframe-cursor ml-[2px] inline-block h-[1.1em] w-[2px] align-middle bg-white"
                aria-hidden="true"
              />
            ) : null}
          </p>

          <div
            className="flex flex-wrap gap-y-1"
            style={{
              opacity: pillsVisible ? 1 : 0,
              transform: pillsVisible ? 'translateY(0)' : 'translateY(8px)',
              transition: 'opacity 0.4s ease, transform 0.4s ease',
            }}
          >
            {PILLS.map((pill) => (
              <button
                key={pill.action}
                type="button"
                onClick={() => handlePill(pill.action)}
                className={`mb-[0.4em] mx-[0.2em] inline-flex items-center justify-center whitespace-nowrap rounded-full px-4 py-[0.3em] text-[13px] transition-colors duration-200 sm:px-5 sm:text-[15px] ${
                  pill.action === 'notice'
                    ? 'border border-white bg-transparent text-white hover:bg-white hover:text-black'
                    : 'border border-black/10 bg-white text-black hover:bg-black hover:text-white'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </motion.div>
      </section>

      {/*
        浮层统一挂在最外层，且用 AnimatePresence 做退场 —— 关掉时直接消失
        会显得很生硬，而这个页面本身就是拿来「看」的。
        层级：演示面板 / 站内信 z-50 压在上面；聊天框与会话栏 z-20，互不重叠（左 46vw + 右 33vw）。
        会话栏写在聊天框**前面**：窄屏下两者都占满宽，后写的聊天框在上层，点聊天必定看得见。
      */}
      <AnimatePresence>
        {sessionsOpen ? <SessionList onClose={() => setSessionsOpen(false)} /> : null}
        {chatOpen ? (
          <ChatPanel
            onClose={() => setChatOpen(false)}
            onShowWorkflow={() => setDemoOpen(true)}
            onShowNotice={() => {
              setNoticeOpen(true);
              void pushNoticeToAssistant();
            }}
          />
        ) : null}
        {demoOpen ? (
          <WorkflowDemo
            snapshot={snapshot}
            citations={citations}
            onClose={() => setDemoOpen(false)}
          />
        ) : null}
        {noticeOpen ? (
          <NoticeCard
            snapshot={snapshot}
            onViewWeekly={() => {
              setNoticeOpen(false);
              onNavigate?.('weekly');
            }}
            onClose={() => setNoticeOpen(false)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default MainframePage;
