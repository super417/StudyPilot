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
