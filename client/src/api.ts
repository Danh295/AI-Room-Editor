import type {
  FloorplanTraceResult,
  LibraryItem,
  ProductDraft,
  Project,
  ProjectSummary,
} from '@room/shared';

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

export type IngestProductInput =
  | { method: 'url'; url: string }
  | { method: 'model'; modelNumber: string }
  | { method: 'query'; query: string }
  | { method: 'photo'; imageBase64: string; mimeType: string; hint?: string };

export interface ResearchNotes {
  text: string;
  citations: { title: string; url: string }[];
  model: string;
}

export interface IngestProductResult {
  draft: ProductDraft;
  research: ResearchNotes;
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

  ingestProduct: (input: IngestProductInput) =>
    request<IngestProductResult>('/ingest/product', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /**
   * Trace a floor plan. The image's natural pixel size is required: the prompt
   * states it, and the returned coordinates are in that space.
   */
  ingestFloorplan2: (imageBase64: string, mimeType: string, width: number, height: number) =>
    request<FloorplanTraceResult>('/ingest/floorplan', {
      method: 'POST',
      body: JSON.stringify({ imageBase64, mimeType, width, height }),
    }),

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
