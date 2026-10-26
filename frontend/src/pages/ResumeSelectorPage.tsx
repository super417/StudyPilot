import { ArrowLeft, ArrowUpRight, FileText, Sparkles } from 'lucide-react';

interface ResumeSelectorPageProps {
  onBack: () => void;
  onSelect: (path: '/resume/practical' | '/resume/interactive') => void;
}

const options = [
  {
    title: '实用简历管理',
    description: '传统简历编辑器，支持多份简历管理、导出 PDF，内容随 StudyPilot 账号同步。',
    path: '/resume/practical' as const,
    icon: FileText,
    accent: 'text-blue-600',
    background: 'bg-blue-50',
  },
  {
    title: '个人网站简历',
    description: '交互式展示学习成果与能力证据，在应用内浏览个人成长。',
    path: '/resume/interactive' as const,
    icon: Sparkles,
    accent: 'text-violet-600',
    background: 'bg-violet-50',
  },
];

function ResumeSelectorPage({ onBack, onSelect }: ResumeSelectorPageProps) {
  return (
    <section className="rounded-3xl border border-white/70 bg-white/85 p-6 shadow-card sm:p-10">
      <button type="button" onClick={onBack} className="mb-8 inline-flex items-center gap-2 text-sm text-brandDark/70 hover:text-brandDark">
        <ArrowLeft size={16} aria-hidden="true" /> 返回
      </button>
      <h1 className="text-3xl font-semibold text-brandDark">选择简历类型</h1>
      <p className="mt-2 text-brandDark/65">按用途选择，之后可以随时返回这里重选。</p>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <article key={option.path} onClick={() => onSelect(option.path)} className="pressable-card flex min-h-72 cursor-pointer flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-lg">
              <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${option.background} ${option.accent}`}>
                <Icon size={34} aria-hidden="true" />
              </div>
              <h2 className="mt-6 text-xl font-semibold text-brandDark">{option.title}</h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-brandDark/65">{option.description}</p>
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); onSelect(option.path); }}
                className="pressable-card mt-6 inline-flex w-fit items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
              >
                进入 <ArrowUpRight size={16} aria-hidden="true" />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default ResumeSelectorPage;
