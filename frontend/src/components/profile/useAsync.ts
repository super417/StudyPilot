import { useEffect, useState } from 'react';

/** 异步取数状态机，供占位卡片实现 loading / error / 数据态。 */
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * 轻量异步取数 hook：挂载时执行一次 fetcher，返回 data/loading/error。
 * 仅用于个人中心占位卡片（fetcher 为 profileMock 中的 Promise 取数函数）。
 */
export function useAsync<T>(fetcher: () => Promise<T>): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;
    setState({ data: null, loading: true, error: null });
    fetcher()
      .then((data) => {
        if (active) setState({ data, loading: false, error: null });
      })
      .catch(() => {
        if (active) setState({ data: null, loading: false, error: '加载失败，请稍后重试' });
      });
    return () => {
      active = false;
    };
    // fetcher 为模块级稳定引用；此处只在挂载时取数一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
