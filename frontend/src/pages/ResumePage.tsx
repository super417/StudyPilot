import React, { useEffect, useRef, useState } from 'react';
import './ResumePage.css';

interface SkillCardData {
  skill: string;
  phase: string;
  masteryPercent: number;
  evidenceCount: number;
  description: string;
}

const ResumePage: React.FC = () => {
  const [stats, setStats] = useState({
    totalDays: 0,
    completedPhases: 0,
    verifiedSkills: 0,
    totalEvidence: 0,
  });

  const [skills] = useState<SkillCardData[]>([
    {
      skill: '二次函数',
      phase: '基础概念',
      masteryPercent: 92,
      evidenceCount: 15,
      description: '掌握二次函数的图像性质、顶点式与一般式互化，能快速判断开口方向与对称轴',
    },
    {
      skill: '一元二次方程',
      phase: '求根公式',
      masteryPercent: 88,
      evidenceCount: 12,
      description: '熟练运用求根公式、韦达定理，能根据判别式判断根的情况',
    },
    {
      skill: '相似三角形',
      phase: '判定与性质',
      masteryPercent: 85,
      evidenceCount: 10,
      description: '掌握相似三角形的三种判定方法，能灵活应用性质求边长与面积比',
    },
  ]);

  const heroRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 模拟数据加载后的数字滚动动画
    const timer = setTimeout(() => {
      setStats({
        totalDays: 127,
        completedPhases: 24,
        verifiedSkills: 18,
        totalEvidence: 156,
      });
    }, 300);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // 数字滚动动画
    const animateValue = (element: HTMLElement, start: number, end: number, duration: number) => {
      const range = end - start;
      const increment = range / (duration / 16);
      let current = start;

      const timer = setInterval(() => {
        current += increment;
        if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
          current = end;
          clearInterval(timer);
        }
        element.textContent = Math.floor(current).toString();
      }, 16);
    };

    const statElements = document.querySelectorAll('.stat-number');
    const targetValues = [stats.totalDays, stats.completedPhases, stats.verifiedSkills, stats.totalEvidence];

    statElements.forEach((el, index) => {
      if (targetValues[index] > 0) {
        animateValue(el as HTMLElement, 0, targetValues[index], 1500);
      }
    });
  }, [stats]);

  const handleCardMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = (y - centerY) / 10;
    const rotateY = (centerX - x) / 10;

    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px)`;
  };

  const handleCardMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.transform = '';
  };

  return (
    <div className="resume-page">
      {/* Hero 区域 */}
      <section className="hero" ref={heroRef}>
        <div className="hero-content">
          <h1 className="hero-title">张同学的学习能力简历</h1>
          <p className="hero-subtitle">基于 StudyPilot 真实学习数据生成</p>

          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-number">0</div>
              <div className="stat-label">学习天数</div>
            </div>
            <div className="stat-item">
              <div className="stat-number">0</div>
              <div className="stat-label">完成阶段</div>
            </div>
            <div className="stat-item">
              <div className="stat-number">0</div>
              <div className="stat-label">已验证能力</div>
            </div>
            <div className="stat-item">
              <div className="stat-number">0</div>
              <div className="stat-label">答题证据数</div>
            </div>
          </div>
        </div>

        {/* 背景装饰 */}
        <div className="grid-bg"></div>
        <div className="scan-line"></div>
      </section>

      {/* 已验证能力卡片区 */}
      <section className="skills-section" ref={cardsRef}>
        <h2 className="section-title">
          <span className="title-icon">✓</span>
          已验证能力
        </h2>

        <div className="skills-grid">
          {skills.map((skill, index) => (
            <div
              key={index}
              className="skill-card"
              onMouseMove={handleCardMouseMove}
              onMouseLeave={handleCardMouseLeave}
            >
              <div className="card-header">
                <h3 className="skill-name">{skill.skill}</h3>
                <div className="progress-ring">
                  <svg width="120" height="120">
                    <circle
                      className="progress-ring-bg"
                      cx="60"
                      cy="60"
                      r="54"
                      fill="none"
                      stroke="#1E293B"
                      strokeWidth="6"
                    />
                    <circle
                      className="progress-ring-circle"
                      cx="60"
                      cy="60"
                      r="54"
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="6"
                      strokeDasharray={2 * Math.PI * 54}
                      strokeDashoffset={2 * Math.PI * 54 - (skill.masteryPercent / 100) * 2 * Math.PI * 54}
                      strokeLinecap="round"
                      transform="rotate(-90 60 60)"
                    />
                  </svg>
                  <div className="progress-text">
                    <div className="progress-percent">{skill.masteryPercent}%</div>
                    <div className="progress-label">掌握度</div>
                  </div>
                </div>
              </div>

              <div className="card-body">
                <div className="meta-row">
                  <span className="meta-item">
                    <span className="meta-icon">📚</span>
                    阶段：{skill.phase}
                  </span>
                  <span className="meta-item">
                    <span className="meta-icon">✏️</span>
                    证据：{skill.evidenceCount} 次作答
                  </span>
                </div>
                <p className="skill-desc">{skill.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default ResumePage;
