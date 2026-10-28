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
import {
  clearResumeAiConfig,
  syncResumeAiConfigFromPersonal,
} from '@/lib/resumeAiConfigBridge';

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
        syncResumeAiConfigFromPersonal(cfg);
        void fetchModels({ preferStored: true });
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiConfigApiError && error.code === 'NO_API_CONFIG') {
          setConn('unconfigured');
          clearResumeAiConfig();
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
    syncResumeAiConfigFromPersonal(cfg);
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
        clearResumeAiConfig();
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
      title=API