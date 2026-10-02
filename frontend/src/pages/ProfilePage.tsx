import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/store/authStore';
import { getBasicProfile } from '@/lib/profilePrefs';
import type { TabKey } from '@/components/TabNav';
import ApiConfigCard from '@/components/profile/ApiConfigCard';
import BasicInfoCard from '@/components/profile/BasicInfoCard';
import CoursesCard from '@/components/profile/CoursesCard';
import LeftRail from '@/components/profile/LeftRail';
import NotesCard from '@/components/profile/NotesCard';
import RightRail from '@/components/profile/RightRail';
import StudyMaterialsCard from '@/components/profile/StudyMaterialsCard';
import StudyProgressCard from '@/components/profile/StudyProgressCard';
import StudyStatsCard from '@/components/profile/StudyStatsCard';
import { ToastHost } from '@/components/profile/Toast';
import { useToast } from '@/components/profile/useToast';

/**
 * 个人中心工作台（Tab: profile）。
 *
 * 三栏工作台布局（lg+）：左栏固定宽（欢迎语 / 头像 / 效率概览 / 快捷入口）、
 * 中栏 flex-1 独立纵向滚动（API 配置置顶最突出 + 各概览卡片）、右栏固定宽
 * （今日待办 / 快捷操作 / 最近动态 / AI 入口）。左右栏不随中栏滚动，只有中栏滚动。
 * < lg：三列自然回流为单列（左栏 → 中栏卡片 → 右栏），整页正常滚动。
 *
 * 关键：所有卡片只挂载一次（同一 DOM 用响应式类在 lg 断点切换布局），
 * 避免 API 配置卡片重复取数、编辑资料弹窗重复渲染等问题。
 *
 * 背景：整屏雪山背景由 App 外壳在 profile tab 下承载（见 App.tsx 的 PROFILE_BACKDROP），
 * 本页不再自绘背景层 —— 页面内部的 fixed + 负 z-index 背景会被外壳不透明渐变按
 * CSS 绘制顺序盖住，只在页面过渡动画期间闪现。
 * 仅前端：无后端的卡片用占位数据 + loading / 空 / 错误态；API 配置卡片经真实
 * /api/api-config 可操作，AES 加密由后端负责，前端仅在 localStorage 存模型 / 强度偏好。
 */
interface ProfilePageProps {
  /** 切换到指定 Tab（快捷入口用） */
  onNavigate?: (tab: TabKey) => void;
}

function ProfilePage({ onNavigate }: ProfilePageProps = {}) {
  const userId = useAuthStore((s) => s.userId);
  const { message, show } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [displayName, setDisplayName] = useState<string>(
    () => getBasicProfile().nickname || '学习者',
  );

  const navigate = (tab: TabKey) => {
    if (onNavigate) onNavigate(tab);
    else show('请从顶部标签切换页面');
  };

  // 中栏卡片序列：API 配置置顶最突出，其余概览卡片纵向堆叠。
  const centerCards = [
    <ApiConfigCard key="api" onToast={show} />,
    <StudyMaterialsCard key="materials" onAction={show} />,
    <StudyProgressCard key="progress" onEnter={() => navigate('overview')} />,
    <StudyStatsCard key="stats" />,
    <CoursesCard key="courses" onAction={show} />,
    <NotesCard key="notes" onAction={show} />,
    <BasicInfoCard
      key="basic"
      editOpen={editOpen}
      onEditOpenChange={setEditOpen}
      onSaved={(p) => setDisplayName(p.nickname || '学习者')}
      onToast={show}
    />,
  ];

  return (
    <div className="relative">
      {/*
        三栏：lg+ 为固定视口高度的横向 flex，仅中栏 overflow-y-auto 滚动，左右栏
        sticky 独立滚动；< lg 回流为纵向单列（flex-col），整页正常滚动。

        列宽与间距参照参考图比例（约 25% / 45% / 30%）：左栏 280、右栏 328，
        栏间距 lg 下 32px。三档间距有明确层级：栏间 gap-8（32px）> 栏内 gap-5（20px），
        视觉上先分栏、再分模块，三块之间不会糊成一片。
        两侧栏各让出 8px 给栏间距，换来中栏宽度不变（仍约 368px），
        避免加宽间隔后把中栏的 API 配置卡挤窄。
      */}
      <div className="flex flex-col gap-5 lg:h-[calc(100vh-11rem)] lg:flex-row lg:gap-8">
        {/* 左栏 */}
        <aside className="relative isolate shrink-0 lg:w-[280px]">
          {/*
            柔光垫（让漂浮文字在深色山体上也能读清）。

            两个关键约束，缺一个就会露出硬边：
            1) 必须放在滚动容器【外面】。滚动容器 overflow-y:auto 会把 overflow-x 也变成
               auto，任何超出其边界的柔光层都会被硬裁出直边 —— 之前柔光垫在 LeftRail 里，
               被 aside 裁掉左/右/上三边，四角就露出了直角。
            2) 必须配 isolate。aside 自成层叠上下文后，-z-10 的柔光层才夹在
               "页面背景之上、文字之下"；否则会掉到 App 外壳背景之下直接消失。

            淡出用【两层嵌套遮罩】而不是单个径向渐变：径向渐变要在矩形框内同时做到
            "中间足够白 + 四边归零"是几何上做不到的（半径必须 ≤ 中心到边的距离，
            结果就是文字两端必然偏淡）。嵌套两层线性遮罩相乘，则能在中部保持满强度、
            只在外圈淡出，四个角自然过渡到完全透明。
          */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-x-4 -top-4 bottom-0 -z-10"
            style={{
              WebkitMaskImage:
                'linear-gradient(to bottom, transparent 0%, #000 9%, #000 86%, transparent 100%)',
              maskImage:
                'linear-gradient(to bottom, transparent 0%, #000 9%, #000 86%, transparent 100%)',
            }}
          >
            <div
              className="h-full w-full"
              style={{
                background: 'rgba(255,255,255,0.6)',
                WebkitMaskImage:
                  'linear-gradient(to right, transparent 0%, #000 6%, #000 94%, transparent 100%)',
                maskImage:
                  'linear-gradient(to right, transparent 0%, #000 6%, #000 94%, transparent 100%)',
              }}
            />
          </div>

          {/* 左栏自己的滚动容器（柔光垫在它外面，不被它裁） */}
          <div className="lg:h-full lg:overflow-y-auto lg:pr-1">
            <LeftRail
              displayName={displayName}
              userId={userId}
              onEditProfile={() => setEditOpen(true)}
              onNavigate={navigate}
            />
          </div>
        </aside>

        {/* 中栏：唯一滚动区 */}
        <main className="min-w-0 flex-1 lg:overflow-y-auto lg:pr-1">
          <motion.div
            className="space-y-5 lg:pb-4"
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.05 } } }}
          >
            {centerCards.map((card, i) => (
              <motion.div
                key={i}
                variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
              >
                {card}
              </motion.div>
            ))}
          </motion.div>
        </main>

        {/* 右栏：整面液态玻璃面板（.liquid-glass，见 index.css） */}
        <aside className="shrink-0 lg:w-[328px] lg:overflow-y-auto lg:pl-1">
          <RightRail onAction={show} onNavigate={navigate} />
        </aside>
      </div>

      <ToastHost message={message} />
    </div>
  );
}

export default ProfilePage;
