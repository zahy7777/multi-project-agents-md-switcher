import type { CandidateRevision, ManagerState } from "../shared/contracts.js";

async function request<T>(url: string, options?: RequestInit) {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers },
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result?.error?.message ?? `请求失败：${response.status}`);
  }
  return result as T;
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});

export const api = {
  state: () => request<ManagerState>("/api/state"),
  addWorkspace: (path: string) =>
    request<ManagerState>("/api/workspaces", post({ path })),
  removeWorkspace: (path: string) =>
    request<ManagerState>("/api/workspaces", {
      method: "DELETE",
      body: JSON.stringify({ path }),
    }),
  scanWorkspace: (path: string) =>
    request<ManagerState>("/api/workspaces/scan", post({ path })),
  scanAllWorkspaces: () =>
    request<ManagerState>("/api/workspaces/scan-all", post({})),
  initializePath: (path: string) =>
    request<ManagerState>("/api/paths/initialize", post({ path })),
  createCandidate: (path: string, name: string, content: string) =>
    request<ManagerState>("/api/candidates", post({ path, name, content })),
  candidateHistory: (path: string, candidateId: string) =>
    request<CandidateRevision[]>(
      `/api/candidates/${encodeURIComponent(candidateId)}/history?${new URLSearchParams({ path })}`,
    ),
  candidateRevision: (path: string, candidateId: string, commit: string) =>
    request<{ content: string; name?: string }>(
      `/api/candidates/${encodeURIComponent(candidateId)}/history/${encodeURIComponent(commit)}?${new URLSearchParams({ path })}`,
    ),
  saveCandidate: (
    path: string,
    candidateId: string,
    name: string,
    content: string,
  ) =>
    request<ManagerState>("/api/candidates", {
      method: "PUT",
      body: JSON.stringify({ path, candidateId, name, content }),
    }),
  lockCandidate: (path: string, candidateId: string) =>
    request<ManagerState>("/api/candidates/lock", post({ path, candidateId })),
  setCandidateArchived: (
    path: string,
    candidateId: string,
    archived: boolean,
  ) =>
    request<ManagerState>(
      "/api/candidates/archive",
      post({ path, candidateId, archived }),
    ),
  resolveConflict: (path: string, name: string, content: string) =>
    request<ManagerState>(
      "/api/conflicts/resolve",
      post({ path, name, content }),
    ),
};
