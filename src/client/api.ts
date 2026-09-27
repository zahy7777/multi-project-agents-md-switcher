import type {
  CandidateRevision,
  FormalStatus,
  ManagerState,
} from "../shared/contracts.js";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, options?: RequestInit) {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers },
  });
  const result = await response.json();
  if (!response.ok) {
    throw new ApiError(
      result?.error?.message ?? `请求失败：${response.status}`,
      response.status,
      result?.error?.code ?? "REQUEST_FAILED",
    );
  }
  return result as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManagerState(value: unknown): value is ManagerState {
  return (
    isRecord(value) &&
    Array.isArray(value.workspaces) &&
    value.workspaces.every((workspace) => typeof workspace === "string") &&
    isRecord(value.workspaceIgnoreRules) &&
    Object.values(value.workspaceIgnoreRules).every(
      (rules) => typeof rules === "string",
    ) &&
    Array.isArray(value.targets) &&
    typeof value.historyPath === "string" &&
    typeof value.diagnosticsPath === "string" &&
    typeof value.userRulesPath === "string"
  );
}

async function requestManagerState(url: string, options?: RequestInit) {
  const result = await request<unknown>(url, options);
  if (!isManagerState(result)) {
    throw new ApiError(
      "本地服务返回的管理状态格式无效，请重启本地服务。",
      502,
      "INVALID_MANAGER_STATE",
    );
  }
  return result;
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});

export const api = {
  state: () => requestManagerState("/api/state"),
  formalStatus: (path: string) =>
    request<FormalStatus | null>(
      `/api/formal-status?${new URLSearchParams({ path })}`,
    ),
  addWorkspace: (path: string) =>
    requestManagerState("/api/workspaces", post({ path })),
  chooseWorkspaceDirectory: () =>
    request<{ path: string | null }>(
      "/api/workspaces/choose-directory",
      post({}),
    ),
  removeWorkspace: (path: string) =>
    requestManagerState("/api/workspaces", {
      method: "DELETE",
      body: JSON.stringify({ path }),
    }),
  scanWorkspace: (path: string) =>
    requestManagerState("/api/workspaces/scan", post({ path })),
  updateWorkspaceIgnore: (path: string, rules: string) =>
    requestManagerState("/api/workspaces/ignore", {
      method: "PUT",
      body: JSON.stringify({ path, rules }),
    }),
  scanAllWorkspaces: () =>
    requestManagerState("/api/workspaces/scan-all", post({})),
  initializePath: (path: string) =>
    requestManagerState("/api/paths/initialize", post({ path })),
  createCandidate: (path: string, name: string, content: string) =>
    requestManagerState("/api/candidates", post({ path, name, content })),
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
    expectedName: string,
    expectedContent: string,
  ) =>
    requestManagerState("/api/candidates", {
      method: "PUT",
      body: JSON.stringify({
        path,
        candidateId,
        name,
        content,
        expectedName,
        expectedContent,
      }),
    }),
  saveDiskFile: (path: string, content: string, expectedContent: string) =>
    requestManagerState("/api/disk-file", {
      method: "PUT",
      body: JSON.stringify({ path, content, expectedContent }),
    }),
  renameCandidate: (
    path: string,
    candidateId: string,
    name: string,
    expectedName: string,
  ) =>
    requestManagerState(
      "/api/candidates/rename",
      post({ path, candidateId, name, expectedName }),
    ),
  deleteCandidate: (path: string, candidateId: string) =>
    requestManagerState("/api/candidates/delete", post({ path, candidateId })),
  lockCandidate: (path: string, candidateId: string) =>
    requestManagerState("/api/candidates/lock", post({ path, candidateId })),
  setCandidateArchived: (
    path: string,
    candidateId: string,
    archived: boolean,
  ) =>
    requestManagerState(
      "/api/candidates/archive",
      post({ path, candidateId, archived }),
    ),
  resolveConflict: (
    path: string,
    name: string,
    content: string,
    strategy: "new-candidate" | "current-revision",
  ) =>
    requestManagerState(
      "/api/conflicts/resolve",
      post({ path, name, content, strategy }),
    ),
};
