import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, Eye, EyeOff, Trash2, PlugZap, Save, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import CardShell from './CardShell';
import ModelSelect from './ModelSelect';
import StrengthSlider from './StrengthSlider';
import {
  ApiConfigApiError,
  deleteApiConfig,
  getApiConfig,
  listApiModelsWithMeta,
  saveApiConfig,
  testApiConfig,
  updateApiConfig,
  type ApiConfigView,
} from '@/lib/apiConfigApi';
import {
  getModelPrefs,
  setModel,
  setStrength,
  type ModelId,
  type ModelOption,
  type StrengthId,
} from '@/lib/modelPrefs';
import { isValidBaseUrl, normalizeClientBaseUrl } from '@/lib/baseUrl';

export interface ApiConfigCardProps {
  onToast: (message: string) => void;
}

/** 连接状态。 */
type ConnState = 'loading' | 'unconfigured' | 'configured' | 'success' | 'failed';

/** 把后端错误码映射为中文文案。 */
function messageForError(error: unknown): string {
  if (!(error instanceof ApiConfigApiError)) return '请求失败，请稍后重试';
  switch (error.code) {
    case 'VALIDATION':
      return 'API Key、模型类型、Base URL 均不能为空';
    case 'INVALID_URL':
      return 'Base URL 需以 http:// 或 https:// 开头';
    case 'VERIFY_TIMEOUT':
      return '连接验证超时，请检查 Base URL 与网络';
    case 'VERIFY_FAILED':
      return '连接验证失败，请检查密钥、模型与地址';
    case 'MODELS_FETCH_FAILED':
      return error.message && error.message !== 'MODELS_FETCH_FAILED'
        ? error.message
        : '无法获取可用模型，请检查 API Key 与 Base URL';
    case 'CONFIG_EXISTS':
      return '已存在配置，请改用更新';
    case 'NO_API_CONFIG':
      return '尚未配置 API';
    case 'UNAUTHENTICATED':
      return '请先登录';
    case 'CRED_UNAVAILABLE':
      return '已存凭据暂不可用，请重新保存';
    case 'NETWORK_ERROR':
      return '无法连接服务器，请检查网络后重试';
    case 'REQUEST_FAILED':
      if (/not found/i.test(error.message)) {
        return '模型列表接口未就绪，请重启后端后再刷新';
      }
      return error.message || '请求失败，请稍后重试';
    default:
      return error.message || '请求失败，请稍后重试';
  }
}

/**
 * API 调用与模型配置卡片。
 *
 * 「选择模型」选项来自用户 API 的 /models，无硬编码默认模型。
 * 安全：apiKey 明文仅存在于本组件输入内存态；已存密钥只展示后端返回的掩码。
 */
function ApiConfigCard({ onToast }: ApiConfigCardProps) {
  const [conn, setConn] = useState<ConnState>('loading');
  const [existing, setExisting] = useState<ApiConfigView | null>(null);

  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [modelType, setModelType] = useState('');
  const [editingKey, setEditingKey] = useState(true);

  const prefs = getModelPrefs();
  const [model, setModelState] = useState<ModelId>(prefs.model || '');
  const [strength, setStrengthState] = useState<StrengthId>(prefs.strength);

  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const modelsAbortRef = useRef(0);
  const modelTypeRef = useRef(modelType);
  const modelRef = useRef(model);
  modelTypeRef.current = modelType;
  modelRef.current = model;

  const fetchModels = useCallback(async (opts: { apiKey?: string; baseUrl?: string; preferStored?: boolean }) => {
    const draftKey = (opts.apiKey ?? '').trim();
    const draftUrl = (opts.baseUrl ?? '').trim();
    const preferStored = Boolean(opts.preferStored);

    if (!preferStored) {
      if (!draftKey || !draftUrl || !isValidBaseUrl(draftUrl)) {
        setModelOptions([]);
        setModelsError(null);
        setModelsLoading(false);
        return;
      }
    } else if (draftUrl && !isValidBaseUrl(draftUrl)) {
      return;
    }

    const ticket = ++modelsAbortRef.current;
    setModelsLoading(true);
    setModelsError(null);
    try {
      const { models: rows, baseUrl: correctedUrl } = await listApiModelsWithMeta({
        apiKey: draftKey,
        baseUrl: draftUrl,
      });
      if (ticket !== modelsAbortRef.current) return;
      if (correctedUrl) {
        setBaseUrl((prev) => (prev === correctedUrl ? prev : correctedUrl));
        setExisting((prev) =>
          prev && prev.baseUrl !== correctedUrl ? { ...prev, baseUrl: correctedUrl } : prev,
        );
      }
      const options: ModelOption[] = rows.map((m) => ({
        id: m.id,
        label: m.name || m.id,
      }));
      setModelOptions(options);

      const currentType = modelTypeRef.current;
      const currentModel = modelRef.current;
      const preferred =
        (currentType && options.some((o) => o.id === currentType) && currentType) ||
        (currentModel && options.some((o) => o.id === currentModel) && currentModel) ||
        options[0]?.id ||
        '';
      if (preferred) {
        setModelState(preferred);
        setModel(preferred);
        setModelType(preferred);
      }
    } catch (error) {
      if (ticket !== modelsAbortRef.current) return;
      setModelOptions([]);
      setModelsError(messageForError(error));
    } finally {
      if (ticket === modelsAbortRef.current) setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getApiConfig()
      .then((cfg) => {
        if (!active) return;
        setExisting(cfg);
        setBaseUrl(cfg.baseUrl);
        setModelType(cfg.modelType);
        if (cfg.modelType) {
          setModelState(cfg.modelType);
          setModel(cfg.modelType);
        }
        setEditingKey(false);
        setConn(cfg.isVerified ? 'success' : 'configured');
        void fetchModels({ preferStored: true });
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiConfigApiError && error.code === 'NO_API_CONFIG') {
          setConn('unconfigured');
        } else {
          setConn('unconfigured');
          setFeedback({ kind: 'err', text: messageForError(error) });
        }
      });
    return () => {
      active = false;
    };
  }, [fetchModels]);

  // 用户正在输入明文 Key 时，凭草稿凭据拉取模型（防抖）
  useEffect(() => {
    if (!editingKey) return;
    const key = apiKey.trim();
    const url = baseUrl.trim();
    if (!key || !url || !isValidBaseUrl(url)) {
      setModelOptions([]);
      setModelsError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void fetchModels({ apiKey: key, baseUrl: url });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [apiKey, baseUrl, editingKey, fetchModels]);

  // 已存密钥场景：Base URL 相对已存值变更时，用已存 Key + 新 URL 刷新列表
  useEffect(() => {
    if (editingKey || !existing) return;
    const url = baseUrl.trim();
    if (!url || !isValidBaseUrl(url)) return;
    if (url === existing.baseUrl.trim()) return;
    const timer = window.setTimeout(() => {
      void fetchModels({ baseUrl: url, preferStored: true });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [baseUrl, editingKey, existing, fetchModels]);

  const applyResult = (cfg: ApiConfigView) => {
    setExisting(cfg);
    setBaseUrl(cfg.baseUrl);
    setModelType(cfg.modelType);
    if (cfg.modelType) {
      setModelState(cfg.modelType);
      setModel(cfg.modelType);
    }
    setApiKey('');
    setShowKey(false);
    setEditingKey(false);
    setConn('success');
    void fetchModels({ preferStored: true });
  };

  const validateForm = (): string | null => {
    if (editingKey && !apiKey.trim()) return '请输入 API Key';
    if (!modelType.trim()) return '请选择模型';
    if (!baseUrl.trim()) return '请输入 Base URL';
    if (!isValidBaseUrl(baseUrl)) return 'Base URL 需以 http:// 或 https:// 开头';
    return null;
  };

  const resolvedBaseUrl = () => normalizeClientBaseUrl(baseUrl);

  const runOperation = async (
    op: () => Promise<ApiConfigView>,
    successText: string,
  ) => {
    setBusy(true);
    setFeedback(null);
    try {
      const cfg = await op();
      applyResult(cfg);
      setFeedback({ kind: 'ok', text: successText });
      onToast(successText);
    } catch (error) {
      setConn(existing ? 'failed' : 'unconfigured');
      setFeedback({ kind: 'err', text: messageForError(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () => {
    const corrected = resolvedBaseUrl();
    if (corrected !== baseUrl.trim()) {
      setBaseUrl(corrected);
      onToast(`已自动纠正 Base URL 为 ${corrected}`);
    }
    const err = validateForm();
    if (err) {
      setFeedback({ kind: 'err', text: err });
      return;
    }
    const input = {
      apiKey: apiKey.trim(),
      modelType: modelType.trim(),
      baseUrl: corrected,
    };
    void runOperation(
      () => (existing ? updateApiConfig(input) : saveApiConfig(input)),
      existing ? '配置已更新' : '配置已保存',
    );
  };

  const handleTest = () => {
    const corrected = resolvedBaseUrl();
    if (corrected !== baseUrl.trim()) {
      setBaseUrl(corrected);
      onToast(`已自动纠正 Base URL 为 ${corrected}`);
    }
    const err = validateForm();
    if (err) {
      setFeedback({ kind: 'err', text: err });
      return;
    }
    const input = {
      apiKey: apiKey.trim(),
      modelType: modelType.trim(),
      baseUrl: corrected,
    };
    void runOperation(() => testApiConfig(input, existing !== null), '连接成功');
  };

  const handleDelete = () => {
    setBusy(true);
    setFeedback(null);
    deleteApiConfig()
      .then(() => {
        setExisting(null);
        setApiKey('');
        setBaseUrl('');
        setModelType('');
        setModelState('');
        setModel('');
        setModelOptions([]);
        setModelsError(null);
        setEditingKey(true);
        setConn('unconfigured');
        setFeedback({ kind: 'ok', text: '配置已清除' });
        onToast('配置已清除');
      })
      .catch((error) => setFeedback({ kind: 'err', text: messageForError(error) }))
      .finally(() => setBusy(false));
  };

  const handleModelChange = (id: ModelId) => {
    setModelState(id);
    setModel(id);
    setModelType(id);
  };

  const handleStrengthChange = (id: StrengthId) => {
    setStrengthState(id);
    setStrength(id);
  };

  const handleRefreshModels = () => {
    const corrected = resolvedBaseUrl();
    if (corrected !== baseUrl.trim()) {
      setBaseUrl(corrected);
      onToast(`已自动纠正 Base URL 为 ${corrected}`);
    }
    if (editingKey) {
      void fetchModels({ apiKey: apiKey.trim(), baseUrl: corrected });
    } else if (existing) {
      void fetchModels({ preferStored: true, baseUrl: corrected });
    } else {
      void fetchModels({ apiKey: apiKey.trim(), baseUrl: corrected });
    }
  };

  const statusBadge = () => {
    const map: Record<ConnState, { text: string; cls: string }> = {
      loading: { text: '读取中…', cls: 'bg-bg text-gray-400' },
      unconfigured: { text: '未配置', cls: 'bg-bg text-gray-500' },
      configured: { text: '已配置', cls: 'bg-brandFaint text-brandDark' },
      success: { text: '连接成功', cls: 'bg-brandFaint text-brandDark' },
      failed: { text: '连接失败', cls: 'bg-danger text-dangerText' },
    };
    const s = map[conn];
    return (
      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.cls}`}>{s.text}</span>
    );
  };

  return (
    <CardShell
      title="API 调用与模型配置"
      icon={<KeyRound size={17} aria-hidden="true" />}
      action={statusBadge()}
      hoverable={false}
      className="border-2 border-brandFaint"
    >
      {conn === 'loading' ? (
        <div className="h-24 animate-pulse rounded-2xl bg-brandFaint/60" aria-label="读取配置中" />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            {conn === 'unconfigured' ? (
              <p className="rounded-2xl bg-bg px-4 py-3 text-sm text-gray-500">
                尚未配置调用凭据。填写 API Key 与 Base URL 后，右侧将自动加载该 API 可用的模型列表。DeepSeek 官方 Base URL 请填 https://api.deepseek.com（不要填 platform.deepseek.com 控制台地址）。
              </p>
            ) : null}

            <div>
              <label className="mb-1 block text-sm font-medium text-brandDark">API Key</label>
              {existing && !editingKey ? (
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate rounded-full bg-bg px-3.5 py-2.5 font-mono text-sm text-gray-500">
                    {existing.apiKeyMasked}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingKey(true);
                      setApiKey('');
                    }}
                    className="rounded-full bg-bg px-3 py-2 text-sm font-medium text-brandDark transition hover:bg-brandFaint"
                  >
                    编辑
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-full border border-brandFaint bg-white px-3.5 py-2.5 pr-10 font-mono text-sm text-brandDark outline-none transition focus:border-brand"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                    className="absolute inset-y-0 right-3 flex items-center text-gray-400 transition hover:text-brandDark"
                  >
                    {showKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                </div>
              )}
              {existing && editingKey ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingKey(false);
                    setApiKey('');
                    setShowKey(false);
                    void fetchModels({ preferStored: true });
                  }}
                  className="mt-1 text-xs text-gray-400 transition hover:text-brandDark"
                >
                  取消编辑，保留原密钥
                </button>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-brandDark">Base URL</label>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                onBlur={() => {
                  const corrected = normalizeClientBaseUrl(baseUrl);
                  if (corrected && corrected !== baseUrl.trim()) {
                    setBaseUrl(corrected);
                    onToast(`已自动纠正为 API 地址：${corrected}`);
                  }
                }}
                placeholder="https://api.deepseek.com"
                className="w-full rounded-full border border-brandFaint bg-white px-3.5 py-2.5 text-sm text-brandDark outline-none transition focus:border-brand"
              />
              {/platform\.deepseek\.com/i.test(baseUrl) ? (
                <p role="alert" className="mt-1.5 text-xs text-dangerText">
                  这是控制台网页地址，不能用来调 API。请改为 https://api.deepseek.com（失焦或保存时会自动纠正）。
                </p>
              ) : !baseUrl.trim() ? (
                <p className="mt-1.5 text-xs text-gray-400">
                  DeepSeek 官方 API：https://api.deepseek.com（不要填 platform.deepseek.com）
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handleTest}
                className="flex items-center gap-1.5 rounded-full bg-bg px-3.5 py-2 text-sm font-medium text-brandDark transition hover:bg-brandFaint disabled:opacity-50"
              >
                <PlugZap size={15} aria-hidden="true" />
                测试连接
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleSave}
                className="flex items-center gap-1.5 rounded-full bg-brandDark px-3.5 py-2 text-sm font-medium text-white transition hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] disabled:opacity-50"
              >
                <Save size={15} aria-hidden="true" />
                {existing ? '更新' : '保存'}
              </button>
              {existing ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleDelete}
                  className="flex items-center gap-1.5 rounded-full bg-danger px-3.5 py-2 text-sm font-medium text-dangerText transition hover:brightness-95 disabled:opacity-50"
                >
                  <Trash2 size={15} aria-hidden="true" />
                  清除
                </button>
              ) : null}
            </div>

            {busy ? <p className="text-sm text-gray-400">处理中…</p> : null}
            {feedback ? (
              <p
                role={feedback.kind === 'err' ? 'alert' : 'status'}
                className={`flex items-center gap-1.5 text-sm ${
                  feedback.kind === 'ok' ? 'text-brand' : 'text-dangerText'
                }`}
              >
                {feedback.kind === 'ok' ? (
                  <CheckCircle2 size={15} aria-hidden="true" />
                ) : (
                  <XCircle size={15} aria-hidden="true" />
                )}
                {feedback.text}
              </p>
            ) : null}
          </div>

          <div className="space-y-5 lg:border-l lg:border-brandFaint lg:pl-6">
            <div className="space-y-2">
              <ModelSelect
                value={model || modelType}
                options={modelOptions}
                onChange={handleModelChange}
                loading={modelsLoading}
                error={modelsError}
                emptyHint={
                  editingKey
                    ? '请先填写 API Key 与 Base URL，将自动加载可用模型'
                    : '点击下方刷新以加载可用模型'
                }
              />
              <button
                type="button"
                disabled={modelsLoading || busy}
                onClick={handleRefreshModels}
                className="flex items-center gap-1.5 text-xs font-medium text-brandDark transition hover:text-brand disabled:opacity-50"
              >
                <RefreshCw size={12} className={modelsLoading ? 'animate-spin' : ''} aria-hidden="true" />
                刷新模型列表
              </button>
            </div>
            <StrengthSlider value={strength} onChange={handleStrengthChange} />
            {!existing ? (
              <p className="text-xs text-gray-400">
                填写 API 后可在此选择模型；推理强度会作用于助手对话与规划生成。
              </p>
            ) : null}
          </div>
        </div>
      )}
    </CardShell>
  );
}

export default ApiConfigCard;
