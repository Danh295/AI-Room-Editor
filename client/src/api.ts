import type { LibraryItem, Project, ProjectSummary } from '@room/shared';

/** Everything goes through the Vite proxy, so paths are same-origin. */
const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    // Surface the server's message when it sent one; a bare status code is
    // useless in a toast.
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`${path}: ${detail}`);
  }

  return (await response.json()) as T;
}

export interface Health {
  ok: boolean;
  dataDir: string;
  /** Which AI provider the server has a key for, or null if none. */
  aiProvider: 'gemini' | 'anthropic' | null;
}

export const api = {
  health: () => request<Health>('/health'),

  listProjects: () => request<ProjectSummary[]>('/projects'),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  saveProject: (project: Project) =>
    request<Project>(`/projects/${project.id}`, {
      method: 'PUT',
      body: JSON.stringify(project),
    }),
  deleteProject: (id: string) =>
    request<{ deleted: boolean }>(`/projects/${id}`, { method: 'DELETE' }),

  getLibrary: () => request<LibraryItem[]>('/library'),
  saveLibraryItem: (item: LibraryItem) =>
    request<LibraryItem>(`/library/${item.id}`, {
      method: 'PUT',
      body: JSON.stringify(item),
    }),
  deleteLibraryItem: (id: string) =>
    request<{ deleted: boolean }>(`/library/${id}`, { method: 'DELETE' }),

  uploadImage: (dataBase64: string) =>
    request<{ assetId: string; bytes: number }>('/assets/upload', {
      method: 'POST',
      body: JSON.stringify({ dataBase64 }),
    }),
  fetchImage: (url: string) =>
    request<{ assetId: string; bytes: number; sourceUrl: string }>('/assets/fetch', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
};

/** URL for a cached image asset. */
export function assetUrl(assetId: string): string {
  return `${BASE}/assets/${assetId}`;
}
