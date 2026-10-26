export const ASSISTANT_GREETING = 'hi，有什么想和我聊聊的吗？';

/** Web Speech 没有性别字段，按已知中文女声名优先选取自然音色。 */
function greetingVoice(voices: SpeechSynthesisVoice[]) {
  const female = /xiaoxiao|xiaoyi|xiaohan|xiaomeng|xiaoxuan|huihui|ting.?ting|meijia|小晓|晓晓|晓伊|慧慧|婷婷|美佳/i;
  const male = /yunxi|yunjian|yunyang|kangkang|kang.?kang|云希|云健|云扬|康康/i;
  const score = (voice: SpeechSynthesisVoice) =>
    (/^zh[-_]CN$/i.test(voice.lang) ? 40 : 0)
    + (female.test(voice.name) ? 100 : 0)
    + (/natural|neural|自然|在线/i.test(voice.name) ? 20 : 0)
    + (/xiaoxiao|晓晓|小晓/i.test(voice.name) ? 10 : 0)
    - (male.test(voice.name) ? 200 : 0);
  return voices.filter((voice) => /^zh(?:[-_]|$)/i.test(voice.lang))
    .sort((a, b) => score(b) - score(a))[0];
}

/** 每次总览入场播报一次；返回清理函数，防止切页后仍然播报。 */
export function startAssistantGreeting(): () => void {
  if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
    return () => {};
  }
  const synth = window.speechSynthesis;
  let disposed = false;
  let entranceStarted = false;
  let allowDefaultVoice = false;
  let attempted = false;
  let awaitingGesture = false;
  let utterance: SpeechSynthesisUtterance | null = null;

  const removeGestureListeners = () => {
    window.removeEventListener('pointerdown', retryOnGesture);
    window.removeEventListener('keydown', retryOnGesture);
  };
  const speak = () => {
    if (disposed || !entranceStarted || attempted || document.hidden) return;
    const voices = synth.getVoices();
    if (!voices.length && !allowDefaultVoice) return;
    attempted = true;
    const greeting = new SpeechSynthesisUtterance(ASSISTANT_GREETING);
    greeting.lang = 'zh-CN';
    const voice = greetingVoice(voices);
    if (voice) greeting.voice = voice;
    greeting.rate = 1;
    greeting.pitch = 1.08;
    greeting.volume = 0.9;
    utterance = greeting;
    greeting.onend = () => { utterance = null; };
    greeting.onerror = (event) => {
      utterance = null;
      if (disposed || event.error !== 'not-allowed') return;
      awaitingGesture = true;
      window.addEventListener('pointerdown', retryOnGesture);
      window.addEventListener('keydown', retryOnGesture);
    };
    synth.speak(greeting);
  };
  function retryOnGesture() {
    if (!awaitingGesture || disposed) return;
    awaitingGesture = false;
    removeGestureListeners();
    attempted = false;
    allowDefaultVoice = true;
    speak();
  }

  // 稍等人偶露出后再开口；部分浏览器的音色列表会异步加载。
  const entranceTimer = window.setTimeout(() => {
    entranceStarted = true;
    speak();
  }, 250);
  const voiceTimer = window.setTimeout(() => {
    allowDefaultVoice = true;
    speak();
  }, 900);
  synth.addEventListener('voiceschanged', speak);

  return () => {
    disposed = true;
    window.clearTimeout(entranceTimer);
    window.clearTimeout(voiceTimer);
    synth.removeEventListener('voiceschanged', speak);
    removeGestureListeners();
    if (utterance) {
      utterance.onend = null;
      utterance.onerror = null;
      synth.cancel();
      utterance = null;
    }
  };
}
