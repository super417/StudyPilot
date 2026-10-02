/**
 * API 配置客户端（个人中心「API 调用与模型配置」）。
 * 对应 /api/api-config；明文 apiKey 仅内存态，不写 localStorage。
 */

import { apiRequest, ApiError } from './httpClient';

export interface ApiConfigView {
  apiKeyMasked: string;
  modelType: string;
  baseUrl: string;
  isVerified: boolean;
}

export interface ApiConfigInput {
  apiKey: string;
  modelType: string;
  baseUrl: string;
}

export type ApiConfigErrorCode =
  | 'VALIDATION'
  | 'INVALID_URL'
  | 'VERIFY_TIMEOUT'
  | 'VERIFY_FAILED'
  | 'CONFIG_EXISTS'
  | 'NO_API_CONFIG'
  | 'UNAUTHENTICATED'
  | 'CRED_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'REQUEST_FAILED'
  | (string & {});

export { ApiError as ApiConfigApiError };

type ConfigResponse = ApiConfigView & { status: string };

export function getApiConfig(): Promise<ApiConfigView> {
  return apiRequest<ConfigResponse>('/api/api-config');
}

export function saveApiConfig(input: ApiConfigInput): Promise<ApiConfigView> {
  return apiRequest<ConfigResponse>('/api/api-config', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateApiConfig(input: ApiConfigInput): Promise<ApiConfigView> {
  return apiRequest<ConfigResponse>('/api/api-config', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function deleteApiConfig(): Promise<{ status: string }> {
  return apiRequest<{ status: string }>('/api/api-config', { method: 'DELETE' });
}

/** 测试连接：后端无独立 test 端点，映射为 POST/PUT（验证通过才落库）。 */
export function testApiConfig(
  input: ApiConfigInput,
  hasExisting: boolean,
): Promise<ApiConfigView> {
  return hasExisting ? updateApiConfig(input) : saveApiConfig(input);
}

export interface ApiModelOption {
  id: string;
  name: string;
}

type ModelsResponse = { status: string; models: ApiModelOption[] };

/**
 * 按用户 API 拉取可用模型列表。
 * 传入草稿 apiKey + baseUrl；都为空时后端使用已存配置解密后请求。
 */
export function listApiModels(input?: {
  apiKey?: string;
  baseUrl?: string;
}): Promise<ApiModelOption[]> {
  return apiRequest<ModelsResponse & { baseUrl?: string }>('/api/api-config/models', {
    method: 'POST',
    body: JSON.stringify({
      apiKey: input?.apiKey ?? '',
      baseUrl: input?.baseUrl ?? '',
    }),
  }).then((res) => res.models ?? []);
}

/** 拉取模型列表，并在后端纠正 Base URL 时一并返回。 */
export function listApiModelsWithMeta(input?: {
  apiKey?: string;
  baseUrl?: string;
}): Promise<{ models: ApiModelOption[]; baseUrl?: string }> {
  return apiRequest<ModelsResponse & { baseUrl?: string }>('/api/api-config/models', {
    method: 'POST',
    body: JSON.stringify({
      apiKey: input?.apiKey ?? '',
      baseUrl: input?.baseUrl ?? '',
    }),
  }).then((res) => ({ models: res.models ?? [], baseUrl: res.baseUrl }));
}
