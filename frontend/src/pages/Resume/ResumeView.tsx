import React from 'react';
import { ResumeData } from '@/types/resume';
import './ResumeView.css';

interface ResumeViewProps {
  data: ResumeData;
}

const ResumeView: React.FC<ResumeViewProps> = ({ data }) => {
  return (
    <div className="resume-view">
      {/* Header */}
      <header className="resume-header">
        <div className="header-content">
          {data.personalInfo.avatar && (
            <img
              src={data.personalInfo.avatar}
              alt={data.personalInfo.name}
              className="avatar"
            />
          )}
          <div className="header-info">
            <h1 className="name">{data.personalInfo.name}</h1>
            <p className="title">{data.personalInfo.title}</p>
            <div className="contact-info">
              <span className="contact-item">
                <i className="icon-email"></i>
                {data.personalInfo.email}
              </span>
              <span className="contact-item">
                <i className="icon-phone"></i>
                {data.personalInfo.phone}
              </span>
              <span className="contact-item">
                <i className="icon-location"></i>
                {data.personalInfo.location}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Summary */}
      {data.summary && (
        <section className="resume-section">
          <h2 className="section-title">个人简介</h2>
          <p className="summary-text">{data.summary}</p>
        </section>
      )}

      {/* Education */}
      {data.education && data.education.length > 0 && (
        <section className="resume-section">
          <h2 className="section-title">教育经历</h2>
          {data.education.map((edu) => (
            <div key={edu.id} className="timeline-item">
              <div className="timeline-header">
                <h3 className="item-title">{edu.school}</h3>
                <span className="timeline-date">
                  {edu.startDate} - {edu.endDate}
                </span>
              </div>
              <div className="timeline-content">
                <p className="item-subtitle">
                  {edu.degree} · {edu.major}
                  {edu.gpa && ` · GPA: ${edu.gpa}`}
                </p>
                {edu.highlights && edu.highlights.length > 0 && (
                  <ul className="highlights-list">
                    {edu.highlights.map((highlight, index) => (
                      <li key={index}>{highlight}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Experience */}
      {data.experience && data.experience.length > 0 && (
        <section className="resume-section">
          <h2 className="section-title">工作经历</h2>
          {data.experience.map((exp) => (
            <div key={exp.id} className="timeline-item">
              <div className="timeline-header">
                <h3 className="item-title">{exp.company}</h3>
                <span className="timeline-date">
                  {exp.startDate} - {exp.endDate}
                </span>
              </div>
              <div className="timeline-content">
                <p className="item-subtitle">{exp.position}</p>
                <p className="item-description">{exp.description}</p>
                {exp.achievements && exp.achievements.length > 0 && (
                  <ul className="achievements-list">
                    {exp.achievements.map((achievement, index) => (
                      <li key={index}>{achievement}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Projects */}
      {data.projects && data.projects.length > 0 && (
        <section className="resume-section">
          <h2 className="section-title">项目经历</h2>
          {data.projects.map((project) => (
            <div key={project.id} className="timeline-item">
              <div className="timeline-header">
                <h3 className="item-title">
                  {project.link ? (
                    <a href={project.link} target="_blank" rel="noopener noreferrer">
                      {project.name}
                    </a>
                  ) : (
                    project.name
                  )}
                </h3>
                <span className="timeline-date">
                  {project.startDate} - {project.endDate}
                </span>
              </div>
              <div className="timeline-content">
                <p className="item-subtitle">{project.role}</p>
                <p className="item-description">{project.description}</p>
                {project.technologies && project.technologies.length > 0 && (
                  <div className="tech-stack">
                    {project.technologies.map((tech, index) => (
                      <span key={index} className="tech-tag">{tech}</span>
                    ))}
                  </div>
                )}
                {project.highlights && project.highlights.length > 0 && (
                  <ul className="highlights-list">
                    {project.highlights.map((highlight, index) => (
                      <li key={index}>{highlight}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Skills */}
      {data.skills && data.skills.length > 0 && (
        <section className="resume-section">
          <h2 className="section-title">专业技能</h2>
          <div className="skills-grid">
            {data.skills.map((category, index) => (
              <div key={index} className="skill-category">
                <h3 className="skill-category-name">{category.category}</h3>
                <div className="skill-tags">
                  {category.skills.map((skill, skillIndex) => (
                    <span key={skillIndex} className="skill-tag">{skill}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Certifications */}
      {data.certifications && data.certifications.length > 0 && (
        <section className="resume-section">
          <h2 className="section-title">证书资质</h2>
          <div className="certifications-grid">
            {data.certifications.map((cert) => (
              <div key={cert.id} className="certification-item">
                <h3 className="cert-name">{cert.name}</h3>
                <p className="cert-issuer">{cert.issuer}</p>
                <p className="cert-date">{cert.date}</p>
                {cert.credentialId && (
                  <p className="cert-id">证书编号: {cert.credentialId}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default ResumeView;
