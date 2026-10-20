import { describe, expect, it, vi } from 'vitest';
import { resolveAssistantNameGate } from '@/lib/assistantNamePromptGate';
import type { BasicProfile } from '@/lib/profilePrefs';

const empty: BasicProfile = {
  nickname: '',
  direction: '',
  targetSchool: '',
  bio: '',
  assistantName: '',
};

describe('resolveAssistantNameGate', () => {
  it('hides when inactive', async () => {
    const result = await resolveAssistantNameGate({
      active: false,
      hasSkipped: () => false,
      getLocal: () => empty,
      fetchProfile: vi.fn(),
    });
    expect(result).toEqual({ action: 'hide', assistantName: '' });
  });

  it('hides when skipped without fetching', async () => {
    const fetchProfile = vi.fn();
    const result = await resolveAssistantNameGate({
      active: true,
      hasSkipped: () => true,
      getLocal: () => ({ ...empty, assistantName: '' }),
      fetchProfile,
    });
    expect(result.action).toBe('hide');
    expect(fetchProfile).not.toHaveBeenCalled();
  });

  it('hides when local cache already has a name without fetching', async () => {
    const fetchProfile = vi.fn();
    const result = await resolveAssistantNameGate({
      active: true,
      hasSkipped: () => false,
      getLocal: () => ({ ...empty, assistantName: '本地小航' }),
      fetchProfile,
    });
    expect(result).toEqual({ action: 'hide', assistantName: '本地小航' });
    expect(fetchProfile).not.toHaveBeenCalled();
  });

  it('does not prompt when local empty but server already named', async () => {
    const result = await resolveAssistantNameGate({
      active: true,
      hasSkipped: () => false,
      getLocal: () => empty,
      fetchProfile: async () => ({ ...empty, assistantName: '服务端小航' }),
    });
    expect(result).toEqual({ action: 'hide', assistantName: '服务端小航' });
  });

  it('shows prompt only after server confirms empty name', async () => {
    const result = await resolveAssistantNameGate({
      active: true,
      hasSkipped: () => false,
      getLocal: () => empty,
      fetchProfile: async () => empty,
    });
    expect(result).toEqual({ action: 'show' });
  });

  it('hides without prompting when fetch fails', async () => {
    const result = await resolveAssistantNameGate({
      active: true,
      hasSkipped: () => false,
      getLocal: () => empty,
      fetchProfile: async () => {
        throw new Error('network');
      },
    });
    expect(result).toEqual({ action: 'hide', assistantName: '' });
  });
});
