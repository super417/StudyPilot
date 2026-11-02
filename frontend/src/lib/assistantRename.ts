/** Only treat a standalone, explicit request as a profile change. */
export function extractAssistantRename(text: string): string | null {
  const match = text.trim().match(/^(?:那)?(?:我)?(?:以后)?(?:就)?(?:叫你|把你的名字改成|给你改名叫)[「“"']?([\p{Script=Han}A-Za-z0-9_]{1,16}?)[」”"']?(?:怎么样|好不好|可以吗)?[？?。！!]?$/u);
  const name = match?.[1] ?? null;
  return name && !/(?:什么|什么意思)$/.test(name) ? name : null;
}
