import { apiRequest } from './httpClient';

export interface NoteRecord {
  id: string;
  title: string;
  subject: string;
  body: string;
  updatedAt: string;
  createdAt: string;
}

export interface NoteInput {
  title: string;
  subject?: string;
  body?: string;
}

export function listNotes(): Promise<{ status: string; notes: NoteRecord[] }> {
  return apiRequest('/api/notes');
}

export function createNote(
  input: NoteInput,
): Promise<{ status: string; note: NoteRecord }> {
  return apiRequest('/api/notes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateNote(
  id: string,
  input: NoteInput,
): Promise<{ status: string; note: NoteRecord }> {
  return apiRequest(`/api/notes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function deleteNote(id: string): Promise<{ status: string; deletedId: string }> {
  return apiRequest(`/api/notes/${id}`, { method: 'DELETE' });
}
