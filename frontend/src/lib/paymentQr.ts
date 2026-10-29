import QRCode from 'qrcode';

/** 在本机生成二维码，支付链接不发送给第三方图像服务。 */
export function generatePaymentQr(codeUrl: string): Promise<string> {
  if (!codeUrl || codeUrl.length > 2048) return Promise.reject(new Error('支付二维码内容无效，请重新查询订单。'));
  return QRCode.toDataURL(codeUrl, { width: 256, margin: 4, errorCorrectionLevel: 'M' });
}
