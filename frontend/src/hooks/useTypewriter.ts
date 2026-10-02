import { useEffect, useState } from 'react';

export interface TypewriterResult {
  displayed: string;
  done: boolean;
}

/** Reveal `text` one character at a time after `startDelay`. */
export function useTypewriter(
  text: string,
  speed = 38,
  startDelay = 600,
): TypewriterResult {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed('');
    setDone(false);
    let index = 0;
    /*
     * 句柄类型必须是 number，不能写 ReturnType<typeof setInterval>：
     * @types/node 把全局 setInterval 的返回类型改成了 NodeJS.Timeout，而这里用的是
     * window.setInterval（返回 number），两者不兼容 —— `tsc --noEmit` 查不出来，
     * 但 `tsc -b`（生产构建）会报 TS2322，把 npm run build 整个卡住。
     */
    let intervalId: number | undefined;

    const delayId = window.setTimeout(() => {
      intervalId = window.setInterval(() => {
        index += 1;
        setDisplayed(text.slice(0, index));
        if (index >= text.length) {
          if (intervalId !== undefined) window.clearInterval(intervalId);
          setDone(true);
        }
      }, speed);
    }, startDelay);

    return () => {
      window.clearTimeout(delayId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [text, speed, startDelay]);

  return { displayed, done };
}
