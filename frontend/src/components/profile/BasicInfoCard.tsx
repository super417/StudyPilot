import { useState } from 'react';
import { UserCircle2 } from 'lucide-react';
import CardShell from './CardShell';
import Modal from './Modal';
import { getBasicProfile, saveBasicProfile, type BasicProfile } from '@/lib/profilePrefs';

export interface BasicInfoCardProps {
  /** 弹窗是否打开（受控，与顶部「编辑资料」共享） */
  editOpen: boolean;
  onEditOpenChange: (open: boolean) => void;
  /** 保存后回调（用于同步头部展示的昵称等） */
  onSaved?: (profile: BasicProfile) => void;
  /** 保存成功反馈 */
  onToast: (message: string) => void;
}

const FIELDS: { key: keyof BasicProfile; label: string; placeholder: string; textarea?: boolean }[] = [
  { key: 'nickname', label: '昵称', placeholder: '如：小明' },
  { key: 'direction', label: '学习方向 / 目标专业', placeholder: '如：计算机科学与技术' },
  { key: 'targetSchool', label: '目标院校', placeholder: '如：某某大学' },
  { key: 'bio', label: '简介', placeholder: '一句话介绍自己的备考目标', textarea: true },
];

/** 基本信息卡片：展示头像、昵称、学习方向、简介；编辑走弹窗表单，本地保存。 */
function BasicInfoCard({ editOpen, onEditOpenChange, onSaved, onToast }: BasicInfoCardProps) {
  const [profile, setProfile] = useState<BasicProfile>(() => getBasicProfile());
  const [draft, setDraft] = useState<BasicProfile>(profile);

  const displayName = profile.nickname || '学习者';

  const openEdit = () => {
    setDraft(profile);
    onEditOpenChange(true);
  };

  const handleSave = () => {
    const saved = saveBasicProfile(draft);
    setProfile(saved);
    onEditOpenChange(false);
    onSaved?.(saved);
    onToast('基本信息已保存');
  };

  const rows: { label: string; value: string }[] = [
    { label: '学习方向', value: profile.direction || '未填写' },
    { label: '目标院校', value: profile.targetSchool || '未填写' },
    { label: '简介', value: profile.bio || '未填写' },
  ];

  return (
    <>
      <CardShell
        title="基本信息"
        icon={<UserCircle2 size={17} aria-hidden="true" />}
        action={
          <button
            type="button"
            onClick={openEdit}
            className="rounded-full px-2.5 py-1 text-sm text-brand transition hover:bg-brandFaint"
          >
            编辑
          </button>
        }
      >
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-lg font-bold text-white">
            {displayName.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-brandDark">{displayName}</p>
            <p className="truncate text-sm text-gray-400">{profile.direction || '尚未设置学习方向'}</p>
          </div>
        </div>
        <dl className="mt-4 space-y-2.5">
          {rows.map((row) => (
            <div key={row.label} className="flex gap-3 text-sm">
              <dt className="w-16 shrink-0 text-gray-400">{row.label}</dt>
              <dd className="min-w-0 flex-1 break-words text-brandDark">{row.value}</dd>
            </div>
          ))}
        </dl>
      </CardShell>

      <Modal open={editOpen} title="编辑资料" onClose={() => onEditOpenChange(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
          className="space-y-4"
        >
          {FIELDS.map((field) => (
            <div key={field.key}>
              <label className="mb-1 block text-sm font-medium text-brandDark">
                {field.label}
              </label>
              {field.textarea ? (
                <textarea
                  value={draft[field.key]}
                  onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  rows={3}
                  className="w-full resize-none rounded-2xl border border-brandFaint bg-white px-3.5 py-2.5 text-sm text-brandDark outline-none transition focus:border-brand"
                />
              ) : (
                <input
                  type="text"
                  value={draft[field.key]}
                  onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  className="w-full rounded-full border border-brandFaint bg-white px-3.5 py-2.5 text-sm text-brandDark outline-none transition focus:border-brand"
                />
              )}
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onEditOpenChange(false)}
              className="rounded-full bg-bg px-4 py-2 text-sm font-medium text-brandDark transition hover:bg-brandFaint"
            >
              取消
            </button>
            <button
              type="submit"
              className="btn-pill px-4 py-2 text-sm font-medium"
            >
              保存
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export default BasicInfoCard;
