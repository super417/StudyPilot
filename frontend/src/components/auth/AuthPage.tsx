import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, BookOpen, LockKeyhole, UserRound } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

const USERNAME_MIN = 3;
const USERNAME_MAX = 64;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

type AuthMode = 'login' | 'register';
type FieldErrors = Partial<Record<'username' | 'password', string>>;

function validate(username: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!username.trim()) {
    errors.username = '请输入用户名';
  } else if (username.trim().length < USERNAME_MIN || username.trim().length > USERNAME_MAX) {
    errors.username = '用户名长度需为 3-64 个字符';
  }

  if (!password) {
    errors.password = '请输入密码';
  } else if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    errors.password = '密码长度需为 8-128 个字符';
  }

  return errors;
}

function AuthPage() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const { error, login, register, clearError } = useAuthStore();

  const isRegister = mode === 'register';

  const switchMode = () => {
    setMode(isRegister ? 'login' : 'register');
    setFieldErrors({});
    clearError();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = validate(username, password);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      if (isRegister) {
        await register(username.trim(), password);
      } else {
        await login(username.trim(), password);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#EAF2EC] via-[#F7FAF8] to-[#FDFEFE] p-4 sm:p-6">
      <motion.section
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
        className="w-full max-w-md rounded-[40px] bg-white p-6 shadow-[0_12px_48px_rgba(6,78,59,0.1)] sm:p-10"
      >
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-[0_0_24px_rgba(16,185,129,0.28)]">
            <BookOpen size={22} strokeWidth={2.5} aria-hidden="true" />
          </div>
          <div>
            <p className="font-display text-sm font-bold uppercase tracking-[0.2em] text-brand">StudyPilot</p>
            <p className="text-xs text-gray-500">基于证据链的学习成长助手</p>
          </div>
        </div>

        <div className="mb-7">
          <p className="mb-2 text-sm font-medium text-brand">{isRegister ? '开始记录你的成长' : '继续你的学习旅程'}</p>
          <h1 className="text-3xl font-black tracking-tight text-brandDark sm:text-4xl">
            {isRegister ? '创建你的学习空间' : '欢迎回来'}
          </h1>
          <p className="mt-2 text-gray-500">{isRegister ? '注册 StudyPilot，保存每一步进度' : '登录 StudyPilot，接着上次继续学习'}</p>
        </div>

        {error && (
          <div role="alert" className="mb-5 rounded-2xl bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
            {error}
          </div>
        )}

        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-brandDark">用户名</span>
            <span className={`flex items-center gap-3 rounded-2xl border bg-[#F7FAF8] px-4 transition-colors focus-within:border-brand ${fieldErrors.username ? 'border-red-300' : 'border-transparent'}`}>
              <UserRound size={18} className="shrink-0 text-brand" aria-hidden="true" />
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                type="text"
                autoComplete="username"
                placeholder="请输入用户名"
                className="h-12 min-w-0 flex-1 bg-transparent text-brandDark outline-none placeholder:text-gray-400"
                disabled={submitting}
              />
            </span>
            {fieldErrors.username && <span className="mt-1 block text-sm text-red-600">{fieldErrors.username}</span>}
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-brandDark">密码</span>
            <span className={`flex items-center gap-3 rounded-2xl border bg-[#F7FAF8] px-4 transition-colors focus-within:border-brand ${fieldErrors.password ? 'border-red-300' : 'border-transparent'}`}>
              <LockKeyhole size={18} className="shrink-0 text-brand" aria-hidden="true" />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                placeholder="请输入密码"
                className="h-12 min-w-0 flex-1 bg-transparent text-brandDark outline-none placeholder:text-gray-400"
                disabled={submitting}
              />
            </span>
            {fieldErrors.password && <span className="mt-1 block text-sm text-red-600">{fieldErrors.password}</span>}
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="btn-pill flex h-13 w-full items-center justify-center gap-2 px-5 py-3.5 font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? '提交中，请稍候…' : isRegister ? '注册 StudyPilot' : '登录 StudyPilot'}
            {!submitting && <ArrowRight size={18} aria-hidden="true" />}
          </button>
        </form>

        <div className="mt-7 border-t border-brandFaint pt-6 text-center text-sm text-gray-500">
          <span>{isRegister ? '已有账号？' : '还没有 StudyPilot 账号？'}</span>{' '}
          <button type="button" onClick={switchMode} disabled={submitting} className="font-semibold text-brandDark underline-offset-4 hover:underline disabled:opacity-60">
            {isRegister ? '登录' : '立即注册'}
          </button>
        </div>
      </motion.section>
    </main>
  );
}

export default AuthPage;
