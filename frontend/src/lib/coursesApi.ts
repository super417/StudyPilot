import { apiRequest } from './httpClient';

export interface CourseRecord {
  id: string;
  name: string;
  status: 'active' | 'paused';
  updatedAt: string;
}

export interface CourseOverview {
  status: string;
  activeCount: number;
  recentCourse: string;
  nextTask: string;
  courses: CourseRecord[];
}

export function fetchCourseOverview(): Promise<CourseOverview> {
  return apiRequest('/api/courses');
}

export function createCourse(name: string): Promise<CourseOverview> {
  return apiRequest('/api/courses', {
    method: 'POST',
    body: JSON.stringify({ name, status: 'active' }),
  });
}

export function updateCourse(
  id: string,
  input: { name: string; status: 'active' | 'paused' },
): Promise<CourseOverview> {
  return apiRequest(`/api/courses/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function deleteCourse(id: string): Promise<CourseOverview> {
  return apiRequest(`/api/courses/${id}`, { method: 'DELETE' });
}

export interface CourseChapter {
  id: string;
  title: string;
  url: string;
  done: boolean;
}

interface ChapterList {
  chapters: CourseChapter[];
}

export function fetchChapters(courseId: string): Promise<CourseChapter[]> {
  return apiRequest<ChapterList>(`/api/courses/${courseId}/chapters`).then(
    (body) => body.chapters,
  );
}

export function createChapter(
  courseId: string,
  input: { title: string; url: string },
): Promise<CourseChapter[]> {
  return apiRequest<ChapterList>(`/api/courses/${courseId}/chapters`, {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((body) => body.chapters);
}

export function setChapterDone(
  courseId: string,
  chapterId: string,
  done: boolean,
): Promise<CourseChapter[]> {
  return apiRequest<ChapterList>(`/api/courses/${courseId}/chapters/${chapterId}`, {
    method: 'PATCH',
    body: JSON.stringify({ done }),
  }).then((body) => body.chapters);
}

export function deleteChapter(courseId: string, chapterId: string): Promise<CourseChapter[]> {
  return apiRequest<ChapterList>(`/api/courses/${courseId}/chapters/${chapterId}`, {
    method: 'DELETE',
  }).then((body) => body.chapters);
}
