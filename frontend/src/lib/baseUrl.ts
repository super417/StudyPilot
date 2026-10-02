/**
 * Base URL 校验（与后端 api_config_service.validate_base_url 一致）。
 * 抽成纯函数便于 Property 6 属性测试。
 */

/** 前端校验通过当且仅当以 http:// 或 https:// 开头（trim 后）。 */
export function isValidBaseUrl(url: string): boolean {
  return /^https?:\/\//.test(url.trim());
}

/** 把 DeepSeek 控制台地址纠正为官方 API Base URL。 */
export function normalizeClientBaseUrl(url: string): string {
  const trimmed = url.trim();
  if (!/platform\.deepseek\.com/i.test(trimmed)) return trimmed;
  if (/\/v1(\/|$)/i.test(trimmed) || /\/v1$/i.test(trimmed)) {
    return 'https://api.deepseek.com/v1';
  }
  return 'https://api.deepseek.com';
}
