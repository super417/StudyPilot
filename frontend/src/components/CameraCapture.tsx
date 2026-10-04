import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import Modal from '@/components/profile/Modal';

export interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

const CAMERA_KEY = 'studypilot.cameraId.v1';

function initialConstraints(): MediaTrackConstraints {
  const saved = localStorage.getItem(CAMERA_KEY);
  if (saved) return { deviceId: { ideal: saved } };
  // 只在手机上要后摄：电脑上「手机连接」等虚拟摄像头也会自称后置，会被误选
  return window.matchMedia('(pointer: coarse)').matches
    ? { facingMode: { ideal: 'environment' } }
    : {};
}

/** 打开摄像头取景，拍下当前画面交给 onCapture；可切换摄像头并记住选择。 */
function CameraCapture({ open, onClose, onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    setError(null);
    setReady(false);
    const video = deviceId ? { deviceId: { exact: deviceId } } : initialConstraints();
    navigator.mediaDevices
      .getUserMedia({ video, audio: false })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setDevices(all.filter((d) => d.kind === 'videoinput'));
        const current = s.getVideoTracks()[0]?.getSettings().deviceId;
        if (current && !deviceId) setDeviceId(current);
      })
      .catch((e: unknown) => {
        const name = e instanceof DOMException ? e.name : '';
        setError(
          name === 'NotAllowedError'
            ? '没有摄像头权限。请在浏览器地址栏允许使用摄像头，或改用「上传图片」。'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? '没有找到这个摄像头，请换一个或改用「上传图片」。'
              : '摄像头打不开（可能被其他程序占用），请改用「上传图片」。',
        );
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, deviceId]);

  const pick = (id: string) => {
    localStorage.setItem(CAMERA_KEY, id);
    setDeviceId(id);
  };

  const shoot = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  };

  return (
    <Modal open={open} title="拍照识题" onClose={onClose}>
      <div className="space-y-3">
        {devices.length > 1 ? (
          <label className="block text-xs text-gray-500">
            摄像头
            <select
              value={deviceId ?? ''}
              onChange={(ev) => pick(ev.target.value)}
              className="mt-1 w-full rounded-full border border-brandFaint bg-white px-3.5 py-2 text-sm text-brandDark outline-none focus:border-brand"
            >
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `摄像头 ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {error ? (
          <p className="text-sm text-dangerText">{error}</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-2xl bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={() => setReady(true)}
                className="aspect-[4/3] w-full object-cover"
              />
            </div>
            <p className="text-xs text-gray-500">
              把题目放平、对准取景框，光线亮一些识别更准。画面不对就在上面换一个摄像头。
            </p>
            <button
              type="button"
              disabled={!ready}
              onClick={shoot}
              className="btn-pill inline-flex w-full items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium disabled:opacity-60"
            >
              <Camera size={16} aria-hidden="true" />
              {ready ? '拍下这一张' : '正在打开摄像头…'}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

export default CameraCapture;
