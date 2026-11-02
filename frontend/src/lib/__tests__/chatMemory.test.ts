import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ consume: vi.fn().mockResolvedValue(undefined), save: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../sseClient', () => ({ consumeSse: mocks.consume }));
vi.mock('../modelPrefs', () => ({ getModelPrefs: () => ({ strength: 'medium' }) }));
vi.mock('../conversationRepository', () => ({ conversationRepository: { saveMessages: mocks.save } }));
import { streamAssistantChat } from '../assistantApi';
import { flushConversation, useAssistantStore } from '@/store/assistantStore';
afterEach(() => vi.unstubAllGlobals());
describe('chat memory transport', () => {
  it('sends the selected conversation ID', async () => {
    await streamAssistantChat('继续', null, {}, undefined, 'selected');
    expect(mocks.consume.mock.lastCall?.[0].body).toMatchObject({ message: '继续', conversationId: 'selected' });
  });
  it('flushes only the requested conversation and propagates save failure', async () => {
    vi.stubGlobal('window', { clearTimeout: vi.fn() });
    const messages = [{ id: '1', role: 'user' as const, content: '我的专业是什么？' }];
    useAssistantStore.setState({ messagesByConversation: { selected: messages, other: [{ id: '2', role: 'user', content: '其他会话' }] } });
    await flushConversation('selected');
    expect(mocks.save).toHaveBeenLastCalledWith('selected', messages);
    mocks.save.mockRejectedValueOnce(new Error('save failed'));
    await expect(flushConversation('selected')).rejects.toThrow('save failed');
  });
});
