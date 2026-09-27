export type Candidate = {
  id: string;
  name: string;
  content: string;
  locked: boolean;
  archived: boolean;
};

export type CandidateRevision = {
  commit: string;
  createdAt: string;
  summary: string;
};

export type RulePath = {
  path: string;
  visibleWorkspaces: string[];
  formalContent: string | null;
  lockedCandidateId: string | null;
  candidates: Candidate[];
  conflict: boolean;
};

export type ManagerState = {
  workspaces: string[];
  workspaceIgnoreRules: Record<string, string>;
  targets: RulePath[];
  historyPath: string;
  diagnosticsPath: string;
  userRulesPath: string;
};

export type FormalStatus = Pick<
  RulePath,
  "path" | "formalContent" | "conflict"
>;

export type ApiFailure = { error: { code: string; message: string } };
