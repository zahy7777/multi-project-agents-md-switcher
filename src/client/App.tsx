import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  Eye,
  FileCode2,
  FolderOpen,
  FolderMinus,
  FolderPlus,
  GitCompare,
  GitBranch,
  Plus,
  PencilLine,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import type {
  Candidate,
  CandidateRevision,
  ManagerState,
} from "../shared/contracts.js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { diffLines } from "diff";
import { api } from "./api.js";

const empty: ManagerState = {
  workspaces: [],
  targets: [],
  historyPath: "",
  diagnosticsPath: "",
  userRulesPath: "",
};

function isWithinWorkspace(targetPath: string, workspace: string) {
  const normalize = (value: string) =>
    value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const target = normalize(targetPath);
  const root = normalize(workspace);
  return target === root || target.startsWith(`${root}/`);
}

function samePath(left: string, right: string) {
  const normalize = (value: string) =>
    value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

function shortPath(value: string, levels = 3) {
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > levels ? `…/${parts.slice(-levels).join("/")}` : value;
}

function LineDiffView({
  changes,
  ariaLabel,
  emptyMessage,
  className = "conflict-diff",
}: {
  changes: ReturnType<typeof diffLines>;
  ariaLabel: string;
  emptyMessage: string;
  className?: string;
}) {
  const changed = changes.flatMap((change, chunkIndex) => {
    const lines = change.value.split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    return lines.map((line, lineIndex) => ({
      line,
      chunkIndex,
      lineIndex,
      change,
    }));
  });
  const hasDifferences = changes.some(
    (change) => change.added || change.removed,
  );

  return (
    <div className={className} aria-label={ariaLabel}>
      {changed.map(({ line, chunkIndex, lineIndex, change }) => (
        <div
          className={`conflict-diff-line ${change.added ? "added" : change.removed ? "removed" : "unchanged"}`}
          key={`${chunkIndex}-${lineIndex}`}
        >
          <span aria-hidden="true">
            {change.added ? "+" : change.removed ? "−" : " "}
          </span>
          <code>{line || " "}</code>
        </div>
      ))}
      {!hasDifferences ? (
        <p className="conflict-diff-empty">{emptyMessage}</p>
      ) : null}
    </div>
  );
}

function App() {
  const [state, setState] = useState(empty);
  const [selectedWorkspace, setSelectedWorkspace] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [candidateFilter, setCandidateFilter] = useState("");
  const [content, setContent] = useState("");
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(true);
  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false);
  const [workspaceInput, setWorkspaceInput] = useState("");
  const [showCandidateForm, setShowCandidateForm] = useState(false);
  const [candidateName, setCandidateName] = useState("");
  const [showInitializeForm, setShowInitializeForm] = useState(false);
  const [initializeInput, setInitializeInput] = useState("");
  const [resolution, setResolution] = useState("");
  const [resolutionName, setResolutionName] = useState("冲突解决结果");
  const [helpOpen, setHelpOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyCandidate, setHistoryCandidate] = useState<Candidate | null>(
    null,
  );
  const [historyTargetPath, setHistoryTargetPath] = useState("");
  const [historyRevisions, setHistoryRevisions] = useState<CandidateRevision[]>(
    [],
  );
  const [selectedHistoryCommit, setSelectedHistoryCommit] = useState("");
  const [historyContent, setHistoryContent] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [showHistoryDiff, setShowHistoryDiff] = useState(true);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareBaseId, setCompareBaseId] = useState("");
  const [showCompareDiff, setShowCompareDiff] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [showConflictDiff, setShowConflictDiff] = useState(true);
  const openingScan = useRef<Promise<ManagerState> | null>(null);
  const saveInFlight = useRef(false);
  const candidateFileInput = useRef<HTMLInputElement>(null);
  const resolutionTargetPath = useRef("");

  const target =
    state.targets.find((item) => item.path === selectedPath) ?? null;
  const candidate =
    target?.candidates.find((item) => item.id === selectedCandidateId) ?? null;
  const candidateQuery = candidateFilter.trim().toLowerCase();
  const visibleCandidates =
    target?.candidates.filter((item) => {
      return (
        item.name.toLowerCase().includes(candidateQuery) ||
        item.content.toLowerCase().includes(candidateQuery)
      );
    }) ?? [];
  const lockedCandidate =
    target?.candidates.find((item) => item.locked) ?? null;
  const compareBase =
    target?.candidates.find((item) => item.id === compareBaseId) ??
    lockedCandidate;
  const compareChanges = useMemo(
    () =>
      compareBase
        ? diffLines(compareBase.content, content, { stripTrailingCr: true })
        : [],
    [compareBase?.content, content],
  );
  const compareLineCounts = compareChanges.reduce(
    (counts, change) => ({
      added: counts.added + (change.added ? change.count : 0),
      removed: counts.removed + (change.removed ? change.count : 0),
    }),
    { added: 0, removed: 0 },
  );
  const historyChanges = useMemo(
    () =>
      historyContent === null
        ? []
        : diffLines(historyContent, content, { stripTrailingCr: true }),
    [historyContent, content],
  );
  const historyLineCounts = historyChanges.reduce(
    (counts, change) => ({
      added: counts.added + (change.added ? change.count : 0),
      removed: counts.removed + (change.removed ? change.count : 0),
    }),
    { added: 0, removed: 0 },
  );
  const lockedCandidateContent = lockedCandidate?.content ?? "";
  const conflictChanges = useMemo(
    () =>
      target?.conflict
        ? diffLines(target.formalContent ?? "", lockedCandidateContent, {
            stripTrailingCr: true,
          })
        : [],
    [target?.conflict, target?.formalContent, lockedCandidateContent],
  );
  const conflictLineCounts = conflictChanges.reduce(
    (counts, change) => ({
      added: counts.added + (change.added ? change.count : 0),
      removed: counts.removed + (change.removed ? change.count : 0),
    }),
    { added: 0, removed: 0 },
  );
  const workspaceTargets = useMemo(
    () =>
      state.targets
        .filter(
          (item) =>
            selectedWorkspace &&
            isWithinWorkspace(item.path, selectedWorkspace),
        )
        .filter((item) =>
          item.path.toLowerCase().includes(filter.toLowerCase()),
        ),
    [state.targets, selectedWorkspace, filter],
  );
  const dirty =
    !!candidate && (content !== candidate.content || name !== candidate.name);
  const userWorkspace = useMemo(() => {
    const file = state.userRulesPath.replace(/\\/g, "/").toLowerCase();
    return state.workspaces.find((workspace) => {
      const normalized = workspace
        .replace(/\\/g, "/")
        .replace(/\/+$/, "")
        .toLowerCase();
      return file === `${normalized}/agents.md`;
    });
  }, [state.userRulesPath, state.workspaces]);

  useEffect(() => {
    let mounted = true;
    openingScan.current ??= api.scanAllWorkspaces();
    void openingScan.current
      .then((next) => {
        if (mounted) setState(next);
      })
      .catch((reason: unknown) => {
        if (!mounted) return;
        setError(message(reason));
        void refresh().catch(() => undefined);
      })
      .finally(() => {
        if (mounted) setStarting(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const workspace = selectedWorkspace || state.workspaces[0] || "";
    if (workspace !== selectedWorkspace) setSelectedWorkspace(workspace);
    if (
      !state.targets.some(
        (item) =>
          item.path === selectedPath &&
          isWithinWorkspace(selectedPath, workspace),
      )
    ) {
      setSelectedPath(
        state.targets.find((item) => isWithinWorkspace(item.path, workspace))
          ?.path ?? "",
      );
    }
  }, [state, selectedWorkspace, selectedPath]);

  useEffect(() => {
    if (!target) {
      setSelectedCandidateId("");
      setContent("");
      setName("");
      return;
    }
    const next =
      candidate ??
      target.candidates.find((item) => item.locked) ??
      target.candidates[0] ??
      null;
    setSelectedCandidateId(next?.id ?? "");
    setContent(next?.content ?? "");
    setName(next?.name ?? "");
  }, [
    target?.path,
    target?.lockedCandidateId,
    selectedCandidateId,
    candidate?.id,
    candidate?.content,
    candidate?.name,
  ]);

  useEffect(() => {
    if (!target?.conflict) {
      resolutionTargetPath.current = "";
      return;
    }
    if (resolutionTargetPath.current !== target.path) {
      setResolution(target.formalContent ?? "");
      resolutionTargetPath.current = target.path;
    }
  }, [target?.path, target?.conflict, target?.formalContent]);

  async function refresh() {
    const next = await api.state();
    setState(next);
    return next;
  }

  async function act(
    action: () => Promise<ManagerState>,
    success: string,
  ): Promise<ManagerState | undefined> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await action();
      setState(next);
      setNotice(success);
      window.setTimeout(() => setNotice(""), 3500);
      return next;
    } catch (reason) {
      setError(message(reason));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function addWorkspace(event: FormEvent) {
    event.preventDefault();
    const next = await act(
      () => api.addWorkspace(workspaceInput),
      "工作空间已添加并完成扫描",
    );
    if (!next) return;
    const added = next.workspaces.find((workspace) =>
      samePath(workspace, workspaceInput),
    );
    if (!added) return;
    setShowWorkspaceForm(false);
    setWorkspaceInput("");
    setSelectedWorkspace(added);
  }

  function chooseWorkspace(workspace: string) {
    if (
      dirty &&
      !window.confirm("当前候选有未保存修改，确定放弃并切换工作空间吗？")
    )
      return;
    setSelectedWorkspace(workspace);
  }

  async function removeWorkspace(workspace: string) {
    if (samePath(workspace, userWorkspace ?? "")) return;
    if (
      samePath(workspace, selectedWorkspace) &&
      dirty &&
      !window.confirm(
        "当前候选有未保存修改，移除后将放弃这些修改。确定继续吗？",
      )
    )
      return;
    if (
      !window.confirm(
        `从列表移除「${pathLeaf(workspace)}」？正式文件、候选和历史都会保留；以后重新添加该路径即可继续管理。`,
      )
    )
      return;
    const next = await act(
      () => api.removeWorkspace(workspace),
      "工作空间已从列表移除，文件和历史均已保留",
    );
    if (!next || !samePath(selectedWorkspace, workspace)) return;
    setSelectedWorkspace(next.workspaces[0] ?? "");
    setSelectedPath("");
  }

  function rescanSelectedWorkspace() {
    const hasUncommittedResolution =
      target?.conflict && resolution !== (target.formalContent ?? "");
    const warnings = [
      dirty
        ? "当前候选有未保存修改；如果扫描发现冲突，可从冲突页把草稿放入解决稿。"
        : "",
      hasUncommittedResolution
        ? "当前冲突解决稿有未保存修改；重扫会更新冲突两侧并保留解决稿，请核对后按需重新载入正式文件。"
        : "",
      dirty ? "建议先保存或导出候选。" : "",
    ].filter(Boolean);
    if (
      warnings.length > 0 &&
      !window.confirm(`${warnings.join("\n")}\n仍要扫描吗？`)
    )
      return;
    void act(
      () => api.scanWorkspace(selectedWorkspace),
      "扫描完成，已导入新发现的规则",
    );
  }

  function chooseTarget(path: string) {
    if (dirty && !window.confirm("当前候选有未保存修改，确定放弃并切换吗？"))
      return;
    setSelectedPath(path);
  }

  function chooseCandidate(item: Candidate) {
    if (dirty && !window.confirm("当前候选有未保存修改，确定放弃并切换吗？"))
      return;
    setSelectedCandidateId(item.id);
    setContent(item.content);
    setName(item.name);
  }

  async function createCandidate(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    const knownIds = new Set(target.candidates.map((item) => item.id));
    const next = await act(
      () => api.createCandidate(target.path, candidateName, content),
      "候选已创建并记录到本地 Git",
    );
    const created = next?.targets
      .find((item) => item.path === target.path)
      ?.candidates.find((item) => !knownIds.has(item.id));
    if (created) {
      setSelectedCandidateId(created.id);
      setContent(created.content);
      setName(created.name);
    }
    if (created) {
      setShowCandidateForm(false);
      setCandidateName("");
    }
  }

  async function importCandidateFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !target) return;
    if (!/\.(md|markdown)$/i.test(file.name)) {
      setError("只能导入 .md 或 .markdown 文件。");
      return;
    }
    if (
      dirty &&
      !window.confirm(
        "当前候选有未保存修改，导入后将切换到新候选。确定继续吗？",
      )
    )
      return;

    const targetPath = target.path;
    const importedName =
      file.name.replace(/\.(md|markdown)$/i, "").trim() || "导入候选";
    const knownIds = new Set(target.candidates.map((item) => item.id));
    let importedContent: string;
    try {
      importedContent = await file.text();
    } catch (reason) {
      setError(message(reason));
      return;
    }

    const next = await act(
      () => api.createCandidate(targetPath, importedName, importedContent),
      "已从文件导入为新候选，正式文件未更改",
    );
    const created = next?.targets
      .find((item) => samePath(item.path, targetPath))
      ?.candidates.find((item) => !knownIds.has(item.id));
    if (!created) return;
    setSelectedPath(targetPath);
    setSelectedCandidateId(created.id);
    setContent(created.content);
    setName(created.name);
  }

  async function resolveActiveConflict() {
    if (!target) return;
    const targetPath = target.path;
    const next = await act(
      () => api.resolveConflict(targetPath, resolutionName, resolution),
      "冲突已解决，正式文件和新候选已恢复一致",
    );
    const resolved = next?.targets.find((item) =>
      samePath(item.path, targetPath),
    );
    if (!resolved?.lockedCandidateId) return;
    const locked = resolved.candidates.find(
      (item) => item.id === resolved.lockedCandidateId,
    );
    if (!locked) return;
    setSelectedPath(resolved.path);
    setSelectedCandidateId(locked.id);
    setContent(locked.content);
    setName(locked.name);
  }

  async function openCandidateHistory() {
    if (!target || !candidate) return;
    setShowHistoryDiff(true);
    setHistoryCandidate(candidate);
    setHistoryTargetPath(target.path);
    setHistoryRevisions([]);
    setSelectedHistoryCommit("");
    setHistoryContent(null);
    setHistoryError("");
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const revisions = await api.candidateHistory(target.path, candidate.id);
      setHistoryRevisions(revisions);
      if (revisions[0]) {
        setSelectedHistoryCommit(revisions[0].commit);
        const version = await api.candidateRevision(
          target.path,
          candidate.id,
          revisions[0].commit,
        );
        setHistoryContent(version.content);
      }
    } catch (reason) {
      setHistoryError(message(reason));
    } finally {
      setHistoryLoading(false);
    }
  }

  async function selectCandidateRevision(revision: CandidateRevision) {
    if (!historyCandidate) return;
    setSelectedHistoryCommit(revision.commit);
    setHistoryContent(null);
    setHistoryError("");
    setHistoryLoading(true);
    try {
      const version = await api.candidateRevision(
        historyTargetPath,
        historyCandidate.id,
        revision.commit,
      );
      setHistoryContent(version.content);
    } catch (reason) {
      setHistoryError(message(reason));
    } finally {
      setHistoryLoading(false);
    }
  }

  async function createCandidateFromHistory() {
    if (!historyCandidate || historyContent === null || !selectedHistoryCommit)
      return;
    if (
      dirty &&
      !window.confirm(
        "当前编辑器有未保存修改。创建历史候选后将切换编辑器，确定继续吗？",
      )
    )
      return;
    const targetPath = historyTargetPath;
    const knownIds = new Set(
      state.targets
        .find((item) => samePath(item.path, targetPath))
        ?.candidates.map((item) => item.id) ?? [],
    );
    const next = await act(
      () =>
        api.createCandidate(
          targetPath,
          `${historyCandidate.name}（历史恢复）`,
          historyContent,
        ),
      "已从历史版本创建新候选；正式文件未更改",
    );
    const created = next?.targets
      .find((item) => samePath(item.path, targetPath))
      ?.candidates.find((item) => !knownIds.has(item.id));
    if (!created) return;
    setSelectedPath(targetPath);
    setSelectedCandidateId(created.id);
    setContent(created.content);
    setName(created.name);
    setHistoryOpen(false);
  }

  async function saveCurrentCandidate() {
    if (
      !target ||
      !candidate ||
      !dirty ||
      busy ||
      target.conflict ||
      saveInFlight.current
    )
      return;
    saveInFlight.current = true;
    try {
      await act(
        () => api.saveCandidate(target.path, candidate.id, name, content),
        candidate.locked
          ? "候选与正式文件已同步并记入历史"
          : "候选已保存并记入历史",
      );
    } finally {
      saveInFlight.current = false;
    }
  }

  function exportCurrentCandidate() {
    if (!candidate) return;
    const safeName = (name || candidate.name)
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/g, "");
    const portableName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safeName)
      ? `_${safeName}`
      : safeName || "candidate";
    const downloadUrl = URL.createObjectURL(
      new Blob([content], { type: "text/markdown;charset=utf-8" }),
    );
    const downloadLink = document.createElement("a");
    downloadLink.href = downloadUrl;
    downloadLink.download = `${portableName}.md`;
    document.body.append(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1_000);
  }

  useEffect(() => {
    function saveFromEditor(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s")
        return;
      if (
        !(event.target instanceof HTMLElement) ||
        !event.target.matches(".candidate-name, .markdown-editor")
      )
        return;
      event.preventDefault();
      void saveCurrentCandidate();
    }
    window.addEventListener("keydown", saveFromEditor);
    return () => window.removeEventListener("keydown", saveFromEditor);
  }, [busy, candidate, content, dirty, name, target?.conflict, target?.path]);

  const relativePath =
    target && selectedWorkspace
      ? target.path.slice(selectedWorkspace.length).replace(/^[\\/]/, "") ||
        "AGENTS.md"
      : "";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <FileCode2 size={20} />
          </span>
          <span>
            <strong>PromptDock</strong>
            <small>本地规则管理</small>
          </span>
        </div>

        <div className="section-heading">
          <span>工作空间</span>
          <button
            className="icon-button"
            aria-label="添加工作空间"
            title="添加工作空间"
            onClick={() => setShowWorkspaceForm(true)}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="workspace-list">
          {state.workspaces.map((workspace) => (
            <div className="workspace-item" key={workspace}>
              <button
                className={`workspace-row ${workspace === selectedWorkspace ? "active" : ""}`}
                onClick={() => chooseWorkspace(workspace)}
                title={workspace}
              >
                <FolderOpen size={15} />
                <span>
                  {pathLeaf(workspace)}
                  {samePath(workspace, userWorkspace ?? "") ? (
                    <em>用户级规则</em>
                  ) : null}
                </span>
                {samePath(workspace, selectedWorkspace) ? (
                  <ChevronRight size={14} />
                ) : null}
              </button>
              {!samePath(workspace, userWorkspace ?? "") ? (
                <button
                  className="workspace-remove"
                  aria-label={`从列表移除工作空间 ${pathLeaf(workspace)}`}
                  title="从列表移除（保留文件、候选和历史）"
                  disabled={busy}
                  onClick={() => void removeWorkspace(workspace)}
                >
                  <FolderMinus size={14} />
                </button>
              ) : null}
            </div>
          ))}
          {state.workspaces.length === 0 && (
            <div className="empty-note">还没有工作空间</div>
          )}
        </div>

        <div className="section-heading rule-heading">
          <span>规则文件</span>
          <div className="heading-actions">
            <span className="count">{workspaceTargets.length}</span>
            {selectedWorkspace ? (
              <>
                <button
                  className="icon-button"
                  aria-label="初始化目录"
                  title="在当前工作空间中初始化规则目录"
                  disabled={busy}
                  onClick={() => {
                    setInitializeInput(selectedWorkspace);
                    setShowInitializeForm(true);
                  }}
                >
                  <FolderPlus size={14} />
                </button>
                <button
                  className="icon-button"
                  aria-label="重新扫描当前工作空间"
                  title="重新扫描当前工作空间"
                  disabled={busy}
                  onClick={rescanSelectedWorkspace}
                >
                  <RefreshCw size={14} />
                </button>
              </>
            ) : null}
          </div>
        </div>
        {selectedWorkspace ? (
          <label className="search-box">
            <Search size={14} />
            <input
              aria-label="筛选规则路径"
              placeholder="筛选路径"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
        ) : null}
        <div className="rule-list">
          {workspaceTargets.map((item) => (
            <button
              key={item.path}
              className={`rule-row ${selectedPath === item.path ? "selected" : ""}`}
              onClick={() => chooseTarget(item.path)}
              title={item.path}
            >
              <span
                className={`rule-dot ${item.conflict ? "conflict" : item.initialized ? "ready" : ""}`}
              />
              <span>
                {item.path
                  .slice(selectedWorkspace.length)
                  .replace(/^[\\/]/, "") || "AGENTS.md"}
              </span>
              {item.conflict ? (
                <AlertTriangle size={14} className="warning" />
              ) : null}
            </button>
          ))}
          {selectedWorkspace && workspaceTargets.length === 0 ? (
            <div className="empty-rules">
              <strong>没有发现 AGENTS.md</strong>
              <span>工作空间已登记，可以初始化根目录规则。</span>
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    () => api.initializePath(selectedWorkspace),
                    "正式文件和首个候选已建立并锁定",
                  )
                }
              >
                初始化 AGENTS.md
              </button>
            </div>
          ) : null}
        </div>

        <div className="sidebar-bottom">
          <div className="history-card">
            <GitBranch size={15} />
            <span>
              <small>本地历史</small>
              <strong>Git 已启用</strong>
            </span>
            <i />
          </div>
          <button className="help-link" onClick={() => setHelpOpen(true)}>
            <CircleHelp size={15} />
            使用说明与诊断
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>工作空间</span>
            <ChevronRight size={14} />
            <strong>
              {selectedWorkspace ? pathLeaf(selectedWorkspace) : "选择目录"}
            </strong>
            {relativePath ? (
              <>
                <ChevronRight size={14} />
                <span>{relativePath}</span>
              </>
            ) : null}
          </div>
          <div className="topbar-status">
            <span className="live-dot" />
            {starting ? "正在扫描已登记路径" : "仅本机运行"}
          </div>
        </header>

        {!target ? (
          <section className="welcome-page">
            <div className="welcome-symbol">
              <FileCode2 size={30} />
            </div>
            <p className="eyebrow">LOCAL RULE WORKSPACE</p>
            <h1>
              把规则版本，<span>清楚地管起来。</span>
            </h1>
            <p>
              添加一个本机目录，扫描 AGENTS.md，创建候选并控制哪一份正式生效。
              <br />
              规则正文只保存在你的设备上。
            </p>
            <button
              className="primary-button"
              onClick={() => setShowWorkspaceForm(true)}
            >
              <Plus size={16} />
              添加工作空间
            </button>
            <div className="feature-list">
              <span>
                <ShieldCheck size={15} />
                本地文件
              </span>
              <span>
                <GitBranch size={15} />
                可追溯历史
              </span>
              <span>
                <Clock3 size={15} />
                保存即记录
              </span>
            </div>
          </section>
        ) : !target.initialized ? (
          <section className="welcome-page init-page">
            <div className="welcome-symbol">
              <FileCode2 size={27} />
            </div>
            <p className="eyebrow">首次初始化</p>
            <h1>
              这个目录还没有<span>正式规则文件</span>
            </h1>
            <p>
              确认后将同时创建正式 AGENTS.md 和首个候选，
              <br />
              并建立锁定关系。
            </p>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void act(
                  () => api.initializePath(target.path),
                  "正式文件和首个候选已建立并锁定",
                )
              }
            >
              <Check size={16} />
              初始化此路径
            </button>
          </section>
        ) : target.conflict ? (
          <section className="page-content">
            <div className="page-title">
              <div>
                <p className="eyebrow">{relativePath}</p>
                <h1>规则文件冲突</h1>
                <p>正式文件与当前锁定候选不同。先合并并确认，再继续切换。</p>
              </div>
              <span className="status danger">
                <AlertTriangle size={14} />
                需要处理
              </span>
            </div>
            <div className="conflict-view-toolbar">
              <span>
                正式文件 → 锁定候选 · 新增 {conflictLineCounts.added} 行 · 删除{" "}
                {conflictLineCounts.removed} 行
              </span>
              <div
                className="conflict-view-switch"
                role="group"
                aria-label="冲突查看方式"
              >
                <button
                  type="button"
                  aria-pressed={!showConflictDiff}
                  className={!showConflictDiff ? "active" : ""}
                  onClick={() => setShowConflictDiff(false)}
                >
                  并排原文
                </button>
                <button
                  type="button"
                  aria-pressed={showConflictDiff}
                  className={showConflictDiff ? "active" : ""}
                  onClick={() => setShowConflictDiff(true)}
                >
                  标记差异
                </button>
              </div>
            </div>
            {showConflictDiff ? (
              <LineDiffView
                changes={conflictChanges}
                ariaLabel="正式文件与锁定候选的行差异"
                emptyMessage="没有可显示的文本差异；请检查正式文件或锁定候选是否缺失。"
              />
            ) : (
              <div className="conflict-grid">
                <div className="compare-panel">
                  <label>磁盘正式文件</label>
                  <pre>{target.formalContent ?? "正式文件已被删除"}</pre>
                </div>
                <div className="compare-panel">
                  <label>锁定候选</label>
                  <pre>{lockedCandidate?.content ?? "锁定候选不存在"}</pre>
                </div>
              </div>
            )}
            <div className="resolution-toolbar">
              <button onClick={() => setResolution(target.formalContent ?? "")}>
                把正式文件放入解决稿
              </button>
              <button
                onClick={() =>
                  setResolution(
                    target.candidates.find((item) => item.locked)?.content ??
                      "",
                  )
                }
              >
                把锁定候选放入解决稿
              </button>
              {dirty ? (
                <button onClick={() => setResolution(content)}>
                  把未保存草稿放入解决稿
                </button>
              ) : null}
              <input
                aria-label="冲突候选名称"
                value={resolutionName}
                onChange={(event) => setResolutionName(event.target.value)}
              />
            </div>
            <textarea
              className="resolution-editor"
              aria-label="冲突解决内容"
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
            />
            <div className="editor-footer">
              <span>确认后会生成新候选，并同步正式文件与锁定候选。</span>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void resolveActiveConflict()}
              >
                <Check size={15} />
                保存解决结果
              </button>
            </div>
          </section>
        ) : (
          <section className="page-content">
            <div className="page-title">
              <div>
                <p className="eyebrow">{relativePath}</p>
                <h1>规则工作台</h1>
                <p>管理此路径的候选，并保持正式文件与锁定候选一致。</p>
              </div>
              <span className="status">
                <span className="live-dot" />
                {target.candidates.find((item) => item.locked)?.name ??
                  "已初始化"}
              </span>
            </div>
            <div className="editor-layout">
              <aside className="candidate-panel">
                <div className="candidate-heading">
                  <span>候选版本</span>
                  <div className="candidate-heading-actions">
                    {candidate && !candidate.locked && lockedCandidate ? (
                      <button
                        aria-label="与其他版本对比"
                        title="将当前编辑器内容与任意其他候选并排查看"
                        disabled={busy}
                        onClick={() => {
                          setCompareBaseId(lockedCandidate?.id ?? "");
                          setCompareOpen(true);
                        }}
                      >
                        <GitCompare size={14} />
                      </button>
                    ) : null}
                    <button
                      aria-label="查看候选历史"
                      title="查看此候选的已保存版本"
                      disabled={busy || historyLoading}
                      onClick={() => void openCandidateHistory()}
                    >
                      <Clock3 size={14} />
                    </button>
                    <button
                      aria-label="新建候选"
                      title="新建候选"
                      disabled={busy}
                      onClick={() => setShowCandidateForm(true)}
                    >
                      <Plus size={15} />
                    </button>
                    <button
                      aria-label="从 Markdown 导入候选"
                      title="导入为未锁定候选，源文件不会被修改"
                      disabled={busy || target.conflict}
                      onClick={() => candidateFileInput.current?.click()}
                    >
                      <Upload size={14} />
                    </button>
                    <input
                      ref={candidateFileInput}
                      aria-label="选择候选 Markdown 文件"
                      type="file"
                      accept=".md,.markdown,text/markdown,text/plain"
                      hidden
                      onChange={(event) => void importCandidateFile(event)}
                    />
                  </div>
                </div>
                <label className="candidate-filter">
                  <Search size={12} />
                  <input
                    aria-label="筛选候选"
                    placeholder="搜索候选名称或内容"
                    value={candidateFilter}
                    onChange={(event) => setCandidateFilter(event.target.value)}
                  />
                </label>
                <div className="candidate-list">
                  {visibleCandidates.map((item) => (
                    <button
                      key={item.id}
                      className={`candidate-row ${item.id === selectedCandidateId ? "active" : ""}`}
                      onClick={() => chooseCandidate(item)}
                    >
                      <FileCode2 size={15} />
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.locked ? "正在生效" : "候选"}</small>
                      </span>
                      {item.locked ? (
                        <span className="lock-mark">
                          <Check size={12} />
                        </span>
                      ) : null}
                    </button>
                  ))}
                  {visibleCandidates.length === 0 ? (
                    <p className="candidate-list-empty">没有匹配的候选。</p>
                  ) : null}
                </div>
                {candidate && !candidate.locked ? (
                  <button
                    className="switch-button"
                    disabled={busy || dirty}
                    onClick={() =>
                      void act(
                        () => api.lockCandidate(target.path, candidate.id),
                        `已锁定「${candidate.name}」，正式文件已同步`,
                      )
                    }
                  >
                    <ArrowDownUp size={14} />
                    切换为正式规则
                  </button>
                ) : null}
                <div className="candidate-foot">
                  <span className="live-dot" />
                  保存时自动记录历史
                </div>
              </aside>
              <div className="editor-panel">
                <div className="editor-toolbar">
                  <div>
                    <span className="file-tab">
                      <FileCode2 size={14} />
                      AGENTS.md
                    </span>
                    <span className="editor-encoding">UTF-8 · Markdown</span>
                  </div>
                  {candidate?.locked ? (
                    <span className="locked-tag">
                      <Check size={12} />
                      锁定中
                    </span>
                  ) : (
                    <span className="draft-tag">候选草稿</span>
                  )}
                  <div
                    className="editor-mode-switch"
                    role="group"
                    aria-label="编辑视图"
                  >
                    <button
                      type="button"
                      aria-pressed={!previewMode}
                      className={!previewMode ? "active" : ""}
                      onClick={() => setPreviewMode(false)}
                    >
                      <PencilLine size={12} />
                      编辑
                    </button>
                    <button
                      type="button"
                      aria-pressed={previewMode}
                      className={previewMode ? "active" : ""}
                      onClick={() => setPreviewMode(true)}
                    >
                      <Eye size={12} />
                      预览
                    </button>
                  </div>
                </div>
                <div
                  className="editor-view"
                  id="candidate-editor-view"
                  aria-label={previewMode ? "Markdown 预览" : "候选编辑器"}
                >
                  {candidate ? (
                    previewMode ? (
                      <div className="candidate-name-preview">{name}</div>
                    ) : (
                      <input
                        className="candidate-name"
                        aria-label="候选名称"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                      />
                    )
                  ) : null}
                  {previewMode ? (
                    <article
                      className="markdown-preview"
                      aria-label="Markdown 预览"
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        skipHtml
                        components={{
                          img: ({ alt }) => (
                            <span className="markdown-image-placeholder">
                              [未加载图片{alt ? `：${alt}` : ""}]
                            </span>
                          ),
                        }}
                      >
                        {content}
                      </ReactMarkdown>
                    </article>
                  ) : (
                    <textarea
                      className="markdown-editor"
                      aria-label="候选内容"
                      spellCheck={false}
                      value={content}
                      onChange={(event) => setContent(event.target.value)}
                    />
                  )}
                </div>
                <div className="editor-footer">
                  <span>
                    {dirty ? "有未保存更改" : "所有更改已保存"} ·{" "}
                    {content.length} 字符
                  </span>
                  <div className="heading-actions">
                    <button
                      className="secondary-button"
                      disabled={!candidate}
                      title="导出当前编辑器内容，包括未保存修改"
                      onClick={exportCurrentCandidate}
                    >
                      <Download size={14} />
                      导出 Markdown
                    </button>
                    <button
                      className="primary-button"
                      disabled={busy || !candidate || !dirty}
                      title={`保存候选（${navigator.platform.toLowerCase().includes("mac") ? "⌘S" : "Ctrl+S"}）`}
                      aria-keyshortcuts="Control+S Meta+S"
                      onClick={() => void saveCurrentCandidate()}
                    >
                      <Save size={15} />
                      {candidate?.locked ? "保存并同步正式文件" : "保存候选"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="formal-card">
              <div>
                <FileCode2 size={15} />
                <span>
                  <small>正式文件位置</small>
                  <strong>{shortPath(`${target.path}/AGENTS.md`)}</strong>
                </span>
              </div>
              <span className="formal-match">
                <Check size={13} />
                与锁定候选一致
              </span>
            </div>
          </section>
        )}

        <footer className="app-footer">
          <span>PromptDock · 你的本地规则不会上传</span>
          <span>
            {state.historyPath
              ? `历史库：${shortPath(state.historyPath, 2)}`
              : "等待本地服务"}
          </span>
        </footer>
      </main>

      {notice || error ? (
        <div role="status" className={`toast ${error ? "toast-error" : ""}`}>
          <span>
            {error ? <AlertTriangle size={16} /> : <Check size={16} />}
          </span>
          <span>{error || notice}</span>
          <button
            aria-label="关闭提示"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {showWorkspaceForm ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.currentTarget === event.target && setShowWorkspaceForm(false)
          }
        >
          <form className="modal-card" onSubmit={addWorkspace}>
            <div className="modal-title">
              <div>
                <p className="eyebrow">添加本机目录</p>
                <h2>添加工作空间</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭"
                onClick={() => setShowWorkspaceForm(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p className="modal-description">
              纯浏览器无法读取任意本地路径，请粘贴或输入目录路径。添加后服务会扫描该目录下所有子目录。
            </p>
            <label className="field-label">
              文件夹路径
              <input
                autoFocus
                required
                placeholder="例如 C:\\Projects\\my-app"
                value={workspaceInput}
                onChange={(event) => setWorkspaceInput(event.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowWorkspaceForm(false)}
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={busy || !workspaceInput.trim()}
              >
                <FolderOpen size={15} />
                {busy ? "正在扫描…" : "添加并扫描"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {showCandidateForm ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.currentTarget === event.target && setShowCandidateForm(false)
          }
        >
          <form className="modal-card" onSubmit={createCandidate}>
            <div className="modal-title">
              <div>
                <p className="eyebrow">候选版本</p>
                <h2>创建候选</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭"
                onClick={() => setShowCandidateForm(false)}
              >
                <X size={16} />
              </button>
            </div>
            <label className="field-label">
              候选名称
              <input
                autoFocus
                required
                placeholder="例如：更严格的代码审查"
                value={candidateName}
                onChange={(event) => setCandidateName(event.target.value)}
              />
            </label>
            <p className="modal-description">
              将编辑器当前内容（包括未保存修改）复制为新版本；创建后可单独编辑和比较。
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowCandidateForm(false)}
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={busy || !candidateName.trim()}
              >
                <Plus size={15} />
                创建候选
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {historyOpen ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.currentTarget === event.target && setHistoryOpen(false)
          }
        >
          <section className="modal-card history-modal">
            <div className="modal-title">
              <div>
                <p className="eyebrow">本机 Git 历史</p>
                <h2>{historyCandidate?.name ?? "候选"} 的已保存版本</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭历史版本"
                onClick={() => setHistoryOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p className="modal-description">
              差异方向：所选历史版本 →
              当前编辑器（含未保存修改）。历史快照只读；创建历史候选不会回滚记录或修改正式文件。
            </p>
            {historyError ? (
              <p className="history-error">读取历史失败：{historyError}</p>
            ) : null}
            <div className="history-layout">
              <div className="history-revisions">
                {historyRevisions.map((revision) => (
                  <button
                    key={revision.commit}
                    className={`history-revision ${selectedHistoryCommit === revision.commit ? "active" : ""}`}
                    aria-pressed={selectedHistoryCommit === revision.commit}
                    onClick={() => void selectCandidateRevision(revision)}
                  >
                    <strong>
                      {new Date(revision.createdAt).toLocaleString()}
                    </strong>
                    <small>
                      {revision.summary} · {revision.commit.slice(0, 7)}
                    </small>
                  </button>
                ))}
                {historyLoading && historyRevisions.length === 0 ? (
                  <p className="history-empty">正在读取历史…</p>
                ) : null}
                {!historyLoading &&
                !historyError &&
                historyRevisions.length === 0 ? (
                  <p className="history-empty">这个候选还没有保存记录。</p>
                ) : null}
              </div>
              <div className="history-version-view">
                <div className="history-preview-toolbar">
                  <span>
                    历史版本 → 当前草稿 · 新增 {historyLineCounts.added} 行 ·
                    删除 {historyLineCounts.removed} 行
                  </span>
                  <div
                    className="conflict-view-switch"
                    aria-label="历史版本查看方式"
                  >
                    <button
                      type="button"
                      className={showHistoryDiff ? "active" : ""}
                      aria-pressed={showHistoryDiff}
                      onClick={() => setShowHistoryDiff(true)}
                    >
                      标记差异
                    </button>
                    <button
                      type="button"
                      className={!showHistoryDiff ? "active" : ""}
                      aria-pressed={!showHistoryDiff}
                      onClick={() => setShowHistoryDiff(false)}
                    >
                      历史全文
                    </button>
                  </div>
                </div>
                {historyContent === null ? (
                  <pre className="history-preview">
                    {historyLoading ? "正在读取版本内容…" : "选择一个历史版本"}
                  </pre>
                ) : showHistoryDiff ? (
                  <LineDiffView
                    changes={historyChanges}
                    ariaLabel="历史版本与当前草稿的差异"
                    emptyMessage="历史版本与当前草稿一致。"
                  />
                ) : (
                  <pre className="history-preview">{historyContent}</pre>
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setHistoryOpen(false)}
              >
                关闭
              </button>
              <button
                className="primary-button"
                disabled={
                  busy ||
                  historyLoading ||
                  !selectedHistoryCommit ||
                  historyContent === null ||
                  !!target?.conflict
                }
                onClick={() => void createCandidateFromHistory()}
              >
                <Clock3 size={14} />
                从此版本创建候选
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {compareOpen && candidate && lockedCandidate && compareBase ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.currentTarget === event.target && setCompareOpen(false)
          }
        >
          <section className="modal-card compare-modal">
            <div className="modal-title">
              <div>
                <p className="eyebrow">只读并排查看</p>
                <h2>候选版本对比</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭版本对比"
                onClick={() => setCompareOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p className="modal-description">
              {dirty
                ? "左侧显示当前编辑器内容（含未保存修改）；右侧显示已保存的基准候选。此窗口只读。"
                : "此窗口不会修改任何文件。"}
            </p>
            <label className="compare-base">
              对比基准
              <select
                aria-label="对比基准版本"
                value={compareBase.id}
                onChange={(event) => setCompareBaseId(event.target.value)}
              >
                {target?.candidates
                  .filter((item) => item.id !== candidate.id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.locked ? "（正式生效）" : ""}
                    </option>
                  ))}
              </select>
            </label>
            <div className="conflict-view-toolbar compare-view-toolbar">
              <span>
                {compareBase.name} → 当前编辑器 · 新增 {compareLineCounts.added}{" "}
                行 · 删除 {compareLineCounts.removed} 行
              </span>
              <div
                className="conflict-view-switch"
                role="group"
                aria-label="候选对比查看方式"
              >
                <button
                  type="button"
                  aria-pressed={!showCompareDiff}
                  className={!showCompareDiff ? "active" : ""}
                  onClick={() => setShowCompareDiff(false)}
                >
                  并排原文
                </button>
                <button
                  type="button"
                  aria-pressed={showCompareDiff}
                  className={showCompareDiff ? "active" : ""}
                  onClick={() => setShowCompareDiff(true)}
                >
                  标记差异
                </button>
              </div>
            </div>
            {showCompareDiff ? (
              <LineDiffView
                changes={compareChanges}
                ariaLabel="对比基准到当前编辑器的行差异"
                emptyMessage="两个版本的正文完全一致。"
                className="conflict-diff candidate-compare-diff"
              />
            ) : (
              <div className="compare-columns">
                <section className="compare-column">
                  <header>
                    <strong>{candidate.name}</strong>
                    <span>{dirty ? "当前草稿" : "候选"}</span>
                  </header>
                  <pre>{content}</pre>
                </section>
                <section className="compare-column">
                  <header>
                    <strong>{compareBase.name}</strong>
                    <span>{compareBase.locked ? "正式生效" : "候选基准"}</span>
                  </header>
                  <pre>{compareBase.content}</pre>
                </section>
              </div>
            )}
            <div className="modal-actions">
              <button
                className="primary-button"
                onClick={() => setCompareOpen(false)}
              >
                返回候选
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {showInitializeForm ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.currentTarget === event.target && setShowInitializeForm(false)
          }
        >
          <form
            className="modal-card"
            onSubmit={async (event) => {
              event.preventDefault();
              const next = await act(
                () => api.initializePath(initializeInput),
                "正式文件和首个候选已建立并锁定",
              );
              if (!next) return;
              const initialized = next.targets.find((item) =>
                samePath(item.path, initializeInput),
              );
              if (!initialized) return;
              setShowInitializeForm(false);
              setSelectedPath(initialized.path);
            }}
          >
            <div className="modal-title">
              <div>
                <p className="eyebrow">新建正式规则路径</p>
                <h2>初始化目录</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭"
                onClick={() => setShowInitializeForm(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p className="modal-description">
              输入工作空间内已存在的文件夹路径。目标目录必须位于当前工作空间中。
            </p>
            <label className="field-label">
              目录路径
              <input
                autoFocus
                required
                value={initializeInput}
                onChange={(event) => setInitializeInput(event.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowInitializeForm(false)}
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={busy || !initializeInput.trim()}
              >
                <FolderPlus size={15} />
                初始化并锁定
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {helpOpen ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.currentTarget === event.target && setHelpOpen(false)
          }
        >
          <section className="modal-card help-card">
            <div className="modal-title">
              <div>
                <p className="eyebrow">帮助与诊断</p>
                <h2>本地运行状态</h2>
              </div>
              <button
                className="icon-button"
                aria-label="关闭"
                onClick={() => setHelpOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p>
              用户级规则路径：<code>{state.userRulesPath || "尚未检测到"}</code>
            </p>
            <p>
              本地诊断日志：<code>{state.diagnosticsPath || "尚未生成"}</code>
            </p>
            <p>
              工作空间目录通过粘贴本机路径添加。正式规则由磁盘保存，候选和 Git
              历史保存在本机数据目录。
            </p>
            <a
              className="log-link"
              href="/api/diagnostics"
              target="_blank"
              rel="noreferrer"
            >
              在浏览器中打开诊断日志
            </a>
            <div className="modal-actions">
              <button
                className="primary-button"
                onClick={() => setHelpOpen(false)}
              >
                知道了
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function pathLeaf(value: string) {
  return (
    value
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) || value
  );
}

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export default App;
