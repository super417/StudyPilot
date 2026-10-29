import { useEffect, useState } from 'react';
import { generatePaymentQr } from '@/lib/paymentQr';

export default function PaymentQr({ codeUrl }: { codeUrl: string }) {
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setImage(null); setError(false);
    void generatePaymentQr(codeUrl).then((result) => { if (active) setImage(result); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [codeUrl]);
  if (error) return <p role="alert">二维码生成失败，请重新查询订单或稍后重试。</p>;
  if (!image) return <p role="status">正在本机生成支付二维码…</p>;
  return <figure><img src={image} width="256" height="256" alt="微信支付二维码，请先核对订单金额后扫码" style={{ maxWidth: '100%', height: 'auto', background: '#fff' }} /><figcaption>使用微信扫码，核对收款方与金额后支付。</figcaption></figure>;
}
