/**
 * 起名条显示门控：不能只凭本地缓存为空就弹窗。
 * ChatWindow / ChatPanel 共用同一套判断 + 共享 fetchBasicProfile。
 */
import type { BasicProfile } from './profilePrefs';

export type AssistantNameGateResult =
  | { action: 'hide'; assistantName: string }
  | { action: 'show' };

export async function resolveAssistantNameGate(deps: {
  active: boolean;
  hasSkipped: () => boolean;
  getLocal: () => BasicProfile;
  fetchProfile: () => Promise<BasicProfile>;
}): Promise<AssistantNameGateResult> {
  if (!deps.active) {
    return { action: 'hide', assistantName: deps.getLocal().assistantName };
  }
  if (deps.hasSkipped()) {
    return { action: 'hide', assistantName: deps.getLocal().assistantName };
  }
  const localName = deps.getLocal().assistantName.trim();
  if (localName) {
    return { action: 'hide', assistantName: localName };
  }
  try {
    const profile = await deps.fetchProfile();
    const serverName = profile.assistantName.trim();
    if (serverName) {
      return { action: 'hide', assistantName: serverName };
    }
    if (deps.hasSkipped()) {
      return { action: 'hide', assistantName: '' };
    }
    return { action: 'show' };
  } catch {
    // 核对失败时不误弹（新设备上服务端可能已有名字）。
    return { action: 'hide', assistantName: '' };
  }
}
