import type { ResumeAbility } from './resumePolish';

interface ResumePdfData {
  nickname?: string;
  direction?: string;
  goalName?: string;
  verified: ResumeAbility[];
  learned: ResumeAbility[];
  awaiting: ResumeAbility[];
}

/** Draw text with the browser's CJK font before handing each A4 page to jsPDF. */
export async function exportResumePdf(data: ResumePdfData): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const canvas = document.createElement('canvas');
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器无法创建 PDF 画布');
  const margin = 86;
  const contentWidth = canvas.width - margin * 2;
  let y = 0;
  let pageNumber = 0;

  function startPage() {
    if (pageNumber > 0) {
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297);
      pdf.addPage();
    }
    pageNumber += 1;
    ctx!.fillStyle = '#ffffff';
    ctx!.fillRect(0, 0, canvas.width, canvas.height);
    ctx!.fillStyle = '#18131f';
    ctx!.font = '700 24px "Microsoft YaHei", sans-serif';
    ctx!.fillText('STUDYPILOT  /  学习能力简历', margin, 74);
    ctx!.fillStyle = '#aaa3ad';
    ctx!.font = '20px "Microsoft YaHei", sans-serif';
    ctx!.fillText(String(pageNumber).padStart(2, '0'), canvas.width - margin - 28, 74);
    y = 140;
  }

  function line(text: string, size = 26, weight = 400, color = '#342d3b', gap = 18) {
    ctx!.font = `${weight} ${size}px "Microsoft YaHei", "Noto Sans SC", sans-serif`;
    ctx!.fillStyle = color;
    const chars = [...text];
    let row = '';
    for (const char of chars) {
      if (ctx!.measureText(row + char).width > contentWidth && row) {
        if (y + size * 1.5 > canvas.height - 100) startPage();
        ctx!.fillText(row, margin, y);
        y += size * 1.5;
        row = char;
      } else row += char;
    }
    if (row) {
      if (y + size * 1.5 > canvas.height - 100) startPage();
      ctx!.fillText(row, margin, y);
      y += size * 1.5 + gap;
    }
  }

  startPage();
  line(data.nickname || '个人学习能力简历', 58, 700, '#1f1626', 14);
  if (data.direction) line(`学习方向：${data.direction}`, 27);
  if (data.goalName) line(`学习目标：${data.goalName}`, 27);
  y += 30;
  const groups: Array<[string, ResumeAbility[]]> = [
    ['已验证能力', data.verified],
    ['已学习未验证', data.learned],
    ['待获得', data.awaiting],
  ];
  for (const [title, items] of groups) {
    if (y + 100 > canvas.height - 100) startPage();
    line(title, 38, 700, '#402750', 16);
    if (items.length === 0) line('暂无记录', 23, 400, '#8f8995', 18);
    for (const item of items) {
      if (y + 180 > canvas.height - 100) startPage();
      line(item.skill, 31, 700, '#1f1626', 6);
      line(item.description, 24, 400, '#45404b', 4);
      const mastery = item.masteryPercent == null ? '暂无证据' : `${item.masteryPercent}%`;
      line(`${item.phase ?? '尚无对应阶段'} · ${item.evidenceCount} 条作答证据 · 掌握度 ${mastery}`, 21, 400, '#77717c', 20);
      y += 16;
    }
    y += 16;
  }
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297);
  pdf.save('StudyPilot-学习能力简历.pdf');
}
