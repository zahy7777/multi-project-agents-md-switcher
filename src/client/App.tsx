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
  Archive,
  ArchiveRestore,
  ArrowDownUp,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Download,
  Eye,
  FileCode2,
  FolderOpen,
  FolderMinus,
  FolderPlus,
  GitFork,
  GitCompare,
  GitBranch,
  Plus,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
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
import { ApiError, api } from "./api.js";

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

function formalFilePath(targetPath: string) {
  const separator = targetPath.includes("\\") ? "\\" : "/";
  return `${targetPath.replace(/[\\/]+$/, "")}${separator}AGENTS.md`;
}

function measureMarkdown(content: string) {
  return {
    lines: content.split(/\r\n|\r|\n/).length,
    characters: Array.from(content).length,
    utf8Bytes: new TextEncoder().encode(content).byteLength,
  };
}

function findTextMatches(content: string, query: string) {
  if (!query) return [];
  const matches: number[] = [];
  let position = content.indexOf(query);
  while (position !== -1) {
    matches.push(position);
    position = content.indexOf(query, position + query.length);
  }
  return matches;
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
  const [showArchivedCandidates, setShowArchivedCandidates] = useState(false);
  const [content, setContent] = useState("");
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replacementText, setReplacementText] = useState("");
  const [activeFindMatch, setActiveFindMatch] = useState(-1);
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const [ruleSearchOpen, setRuleSearchOpen] = useState(false);
  const [ruleSearchQuery, setRuleSearchQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(true);
  const [hasInitialState, setHasInitialState] = useState(false);
  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false);
  const [workspaceInput, setWorkspaceInput] = useState("");
  const [showCandidateForm, setShowCandidateForm] = useState(false);
  const [candidateName, setCandidateName] = useState("");
  const [candidateSourceId, setCandidateSourceId] = useState("");
  const [showRenameCandidateForm, setShowRenameCandidateForm] = useState(false);
  const [renameCandidateName, setRenameCandidateName] = useState("");
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
  const [historyRevisionName, setHistoryRevisionName] = useState<string | null>(
    null,
  );
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [showHistoryDiff, setShowHistoryDiff] = useState(true);
  const [compareOpen, setCompareOpen] = useState(false);
  const [switchPreviewOpen, setSwitchPreviewOpen] = useState(false);
  const [compareBaseId, setCompareBaseId] = useState("");
  const [showCompareDiff, setShowCompareDiff] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [showConflictDiff, setShowConflictDiff] = useState(true);
  const [copiedItem, setCopiedItem] = useState<
    "content" | "formal-path" | "resolution" | null
  >(null);
  const openingScan = useRef<Promise<ManagerState> | null>(null);
  const openingState = useRef<Promise<ManagerState> | null>(null);
  const copyFeedbackTimeout = useRef<number | null>(null);
  const saveInFlight = useRef(false);
  const candidateFileInput = useRef<HTMLInputElement>(null);
  const candidateEditor = useRef<HTMLTextAreaElement>(null);
  const resolutionTargetPath = useRef("");
  const workspaceNameCounts = new Map<string, number>();
  for (const workspace of state.workspaces) {
    const name = pathLeaf(workspace).toLowerCase();
    workspaceNameCounts.set(name, (workspaceNameCounts.get(name) ?? 0) + 1);
  }
  const duplicateWorkspaceNames = new Set(
    [...workspaceNameCounts]
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
  );

  function workspaceParentContext(workspace: string) {
    const parentsOf = (value: string) =>
      value.replace(/\\/g, "/").split("/").filter(Boolean).slice(0, -1);
    const parents = parentsOf(workspace);
    const peers = state.workspaces.filter(
      (item) =>
        item !== workspace &&
        pathLeaf(item).toLowerCase() === pathLeaf(workspace).toLowerCase(),
    );
    for (let depth = 1; depth <= parents.length; depth += 1) {
      const suffix = parents.slice(-depth).join("/");
      const collides = peers.some((peer) => {
        const peerParents = parentsOf(peer);
        return (
          peerParents.slice(-depth).join("/").toLowerCase() ===
          suffix.toLowerCase()
        );
      });
      if (!collides) {
        return parents.length > depth ? `…/${suffix}` : suffix;
      }
    }
    return parents.join("/");
  }

  function workspaceLabel(workspace: string) {
    const name = pathLeaf(workspace);
    return duplicateWorkspaceNames.has(name.toLowerCase())
      ? `${name}（${workspaceParentContext(workspace)}）`
      : name;
  }

  const target =
    state.targets.find((item) => item.path === selectedPath) ?? null;
  const candidate =
    target?.candidates.find((item) => item.id === selectedCandidateId) ?? null;
  const candidateQuery = candidateFilter.trim().toLowerCase();
  const visibleCandidates =
    target?.candidates.filter((item) => {
      if (item.archived !== showArchivedCandidates) return false;
      return (
        item.name.toLowerCase().includes(candidateQuery) ||
        item.content.toLowerCase().includes(candidateQuery)
      );
    }) ?? [];
  const candidateNameCounts = new Map<string, number>();
  for (const item of target?.candidates ?? []) {
    const normalizedName = item.name.trim().toLowerCase();
    candidateNameCounts.set(
      normalizedName,
      (candidateNameCounts.get(normalizedName) ?? 0) + 1,
    );
  }
  const lockedCandidate =
    target?.candidates.find((item) => item.locked) ?? null;
  const normalizedRuleSearchQuery = ruleSearchQuery
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
  const ruleSearchResults = useMemo(() => {
    if (!normalizedRuleSearchQuery) return [];
    const results: {
      key: string;
      targetPath: string;
      label: string;
      candidateId: string | null;
      content: string;
      archived: boolean;
    }[] = [];
    for (const item of state.targets) {
      if (
        !state.workspaces.some((workspace) =>
          isWithinWorkspace(item.path, workspace),
        )
      )
        continue;
      const locked = item.candidates.find((saved) => saved.locked);
      const normalizedFormal = item.formalContent?.replace(/\s+/g, " ").trim();
      const formalMatches = normalizedFormal
        ?.toLocaleLowerCase()
        .includes(normalizedRuleSearchQuery);
      const formalRepresentedByLockedCandidate =
        formalMatches && locked?.content === item.formalContent;
      if (formalMatches && !formalRepresentedByLockedCandidate) {
        results.push({
          key: `${item.path}:formal`,
          targetPath: item.path,
          label: item.conflict ? "磁盘文件 · 不一致" : "磁盘文件",
          candidateId: item.lockedCandidateId,
          content: item.formalContent ?? "",
          archived: false,
        });
      }
      for (const saved of item.candidates) {
        if (
          !saved.content
            .replace(/\s+/g, " ")
            .trim()
            .toLocaleLowerCase()
            .includes(normalizedRuleSearchQuery)
        )
          continue;
        results.push({
          key: `${item.path}:candidate:${saved.id}`,
          targetPath: item.path,
          label: saved.archived
            ? `缓存方案 · ${saved.name} · 已归档`
            : saved.locked
              ? `缓存方案 · ${saved.name} · 当前方案`
              : `缓存方案 · ${saved.name}`,
          candidateId: saved.id,
          content: saved.content,
          archived: saved.archived,
        });
      }
    }
    return results.map((result) => {
      const normalizedContent = result.content.replace(/\s+/g, " ").trim();
      const matchIndex = normalizedContent
        .toLocaleLowerCase()
        .indexOf(normalizedRuleSearchQuery);
      const start = Math.max(0, matchIndex - 56);
      const end = Math.min(
        normalizedContent.length,
        matchIndex + normalizedRuleSearchQuery.length + 96,
      );
      return {
        ...result,
        excerptBefore: `${start > 0 ? "…" : ""}${normalizedContent.slice(start, matchIndex)}`,
        excerptMatch: normalizedContent.slice(
          matchIndex,
          matchIndex + normalizedRuleSearchQuery.length,
        ),
        excerptAfter: `${normalizedContent.slice(matchIndex + normalizedRuleSearchQuery.length, end)}${end < normalizedContent.length ? "…" : ""}`,
      };
    });
  }, [normalizedRuleSearchQuery, state.targets, state.workspaces]);
  const selectedSourceCandidate =
    target?.candidates.find((item) => item.id === candidateSourceId) ?? null;
  const compareBase =
    compareBaseId === "__disk__" && target?.formalContent !== null && target
      ? {
          id: "__disk__",
          name: "磁盘文件",
          content: target.formalContent ?? "",
          locked: false,
          archived: false,
        }
      : (target?.candidates.find((item) => item.id === compareBaseId) ??
        lockedCandidate);
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
  const switchChanges = useMemo(
    () =>
      target && candidate && !candidate.locked
        ? diffLines(target.formalContent ?? "", candidate.content, {
            stripTrailingCr: true,
          })
        : [],
    [target?.formalContent, candidate?.content, candidate?.locked],
  );
  const switchLineCounts = switchChanges.reduce(
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
        ? diffLines(lockedCandidateContent, target.formalContent ?? "", {
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
  const formalSyncChanges = useMemo(
    () =>
      candidate?.locked
        ? diffLines(target?.formalContent ?? "", content, {
            stripTrailingCr: true,
          })
        : [],
    [candidate?.locked, target?.formalContent, content],
  );
  const formalSyncImpact = formalSyncChanges.reduce(
    (impact, change) => ({
      added: impact.added + (change.added ? change.count : 0),
      removed: impact.removed + (change.removed ? change.count : 0),
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
  const candidateContentDirty = !!candidate && content !== candidate.content;
  const findMatchPositions = useMemo(
    () => findTextMatches(content, findQuery),
    [content, findQuery],
  );
  const resolutionDirty =
    !!target?.conflict &&
    (resolution !== (target.formalContent ?? "") ||
      resolutionName !== "冲突解决结果");
  const contentMetrics = useMemo(() => measureMarkdown(content), [content]);
  const resolutionMetrics = useMemo(
    () => measureMarkdown(resolution),
    [resolution],
  );
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
    openingState.current ??= api.state();
    void openingState.current
      .then((cached) => {
        if (mounted) {
          setState(cached);
          setHasInitialState(true);
        }
      })
      .then(() => {
        openingScan.current ??= api.scanAllWorkspaces();
        return openingScan.current;
      })
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
    let running = false;
    const syncFormalStatuses = async () => {
      if (running || !selectedPath || document.visibilityState !== "visible")
        return;
      running = true;
      try {
        const status = await api.formalStatus(selectedPath);
        setState((current) => ({
          ...current,
          targets: current.targets.map((target) => {
            return status && status.path === target.path
              ? {
                  ...target,
                  formalContent: status.formalContent,
                  conflict: status.conflict,
                }
              : target;
          }),
        }));
      } catch {
        // Keep the last known state; the next interval or focus will retry.
      } finally {
        running = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void syncFormalStatuses();
    };
    const timer = window.setInterval(() => void syncFormalStatuses(), 2000);
    document.addEventListener("visibilitychange", onVisibility);
    void syncFormalStatuses();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [selectedPath]);

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
      setResolutionName("冲突解决结果");
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

  function confirmLeavingCurrentDraft(action: string) {
    const drafts = [
      dirty ? "方案内容" : "",
      resolutionDirty ? "冲突解决稿" : "",
    ].filter(Boolean);
    if (drafts.length === 0) return true;
    return window.confirm(
      `${drafts.join("和")}有未保存修改；${action}后会丢失。确定继续吗？`,
    );
  }

  async function addWorkspace(event: FormEvent) {
    event.preventDefault();
    if (!confirmLeavingCurrentDraft("添加并切换工作空间")) return;
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

  async function chooseWorkspaceDirectory() {
    setBusy(true);
    setError("");
    try {
      const { path } = await api.chooseWorkspaceDirectory();
      if (path) setWorkspaceInput(path);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  function chooseWorkspace(workspace: string) {
    if (!confirmLeavingCurrentDraft("切换工作空间")) return;
    setShowArchivedCandidates(false);
    setSelectedWorkspace(workspace);
  }

  async function removeWorkspace(workspace: string) {
    if (samePath(workspace, userWorkspace ?? "")) return;
    if (
      samePath(workspace, selectedWorkspace) &&
      !confirmLeavingCurrentDraft("移除当前工作空间")
    )
      return;
    if (
      !window.confirm(
        `从列表移除「${workspaceLabel(workspace)}」？磁盘文件、缓存方案和历史版本都会保留；以后重新添加该路径即可继续管理。`,
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
    const warnings = [
      dirty
        ? "当前方案有未保存修改；如果扫描发现冲突，可从冲突页把草稿放入解决稿。"
        : "",
      resolutionDirty
        ? "当前冲突解决稿有未保存修改；重扫会更新冲突两侧并保留解决稿，请核对后按需重新载入磁盘文件。"
        : "",
      dirty ? "建议先保存或导出当前方案。" : "",
    ].filter(Boolean);
    if (
      warnings.length > 0 &&
      !window.confirm(`${warnings.join("\n")}\n仍要扫描吗？`)
    )
      return;
    void act(
      () => api.scanWorkspace(selectedWorkspace),
      "扫描完成，已发现并载入新文件",
    );
  }

  function chooseTarget(path: string) {
    if (!confirmLeavingCurrentDraft("切换文件路径")) return;
    setShowArchivedCandidates(false);
    setSelectedPath(path);
  }

  function chooseCandidate(item: Candidate) {
    if (dirty && !window.confirm("当前方案有未保存修改，确定放弃并切换吗？"))
      return;
    setSelectedCandidateId(item.id);
    setContent(item.content);
    setName(item.name);
  }

  async function renameCurrentCandidate(event: FormEvent) {
    event.preventDefault();
    if (!target || !candidate || dirty || target.conflict || busy) return;
    const nextName = renameCandidateName.trim();
    if (!nextName) return;
    const next = await act(
      () =>
        api.renameCandidate(
          target.path,
          candidate.id,
          nextName,
          candidate.name,
        ),
      `缓存方案已重命名为「${nextName}」`,
    );
    if (!next) return;
    setName(nextName);
    setShowRenameCandidateForm(false);
  }

  async function deleteCurrentCandidate() {
    if (
      !target ||
      !candidate ||
      candidate.locked ||
      dirty ||
      target.conflict ||
      busy
    )
      return;
    if (
      !window.confirm(
        `确定删除缓存方案「${candidate.name}」吗？它会从缓存方案列表和搜索结果中移除；本机 Git 历史仍会保留此前记录。此操作不能在界面中撤销。`,
      )
    )
      return;
    const targetPath = target.path;
    const deletedName = candidate.name;
    const next = await act(
      () => api.deleteCandidate(targetPath, candidate.id),
      `已删除缓存方案「${deletedName}」`,
    );
    if (!next) return;
    const updatedTarget = next.targets.find((item) => item.path === targetPath);
    const currentCache = updatedTarget?.candidates.find((item) => item.locked);
    if (currentCache) {
      setSelectedCandidateId(currentCache.id);
      setContent(currentCache.content);
      setName(currentCache.name);
    }
    setShowArchivedCandidates(false);
  }

  function openRuleSearchResult(result: (typeof ruleSearchResults)[number]) {
    const destination = state.targets.find(
      (item) => item.path === result.targetPath,
    );
    if (!destination) return;
    const nextCandidate = result.candidateId
      ? destination.candidates.find((item) => item.id === result.candidateId)
      : null;
    const nextCandidateId = nextCandidate?.id ?? "";
    if (
      selectedPath !== destination.path ||
      selectedCandidateId !== nextCandidateId
    ) {
      if (!confirmLeavingCurrentDraft("打开搜索结果")) return;
      const workspace = state.workspaces
        .filter((item) => isWithinWorkspace(destination.path, item))
        .sort((left, right) => right.length - left.length)[0];
      if (workspace) setSelectedWorkspace(workspace);
      setSelectedPath(destination.path);
      setSelectedCandidateId(nextCandidateId);
      setContent(nextCandidate?.content ?? "");
      setName(nextCandidate?.name ?? "");
      setShowArchivedCandidates(nextCandidate?.archived ?? false);
      setPreviewMode(false);
    }
    setRuleSearchOpen(false);
  }

  async function archiveCurrentCandidate() {
    if (
      !target ||
      !candidate ||
      candidate.locked ||
      candidate.archived ||
      dirty
    )
      return;
    const next = await act(
      () => api.setCandidateArchived(target.path, candidate.id, true),
      `已归档「${candidate.name}」，方案正文和历史版本仍保留`,
    );
    if (!next) return;
    const currentTarget = next.targets.find(
      (item) => item.path === target.path,
    );
    const locked = currentTarget?.candidates.find((item) => item.locked);
    if (locked) {
      setSelectedCandidateId(locked.id);
      setContent(locked.content);
      setName(locked.name);
    }
    setShowArchivedCandidates(false);
  }

  async function restoreCurrentCandidate() {
    if (!target || !candidate?.archived || dirty) return;
    const next = await act(
      () => api.setCandidateArchived(target.path, candidate.id, false),
      `已恢复「${candidate.name}」`,
    );
    if (next) setShowArchivedCandidates(false);
  }

  async function openCandidateSwitchPreview() {
    if (
      !target ||
      !candidate ||
      candidate.locked ||
      candidate.archived ||
      dirty ||
      target.conflict ||
      busy
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const latest = await api.state();
      setState(latest);
      const latestTarget = latest.targets.find(
        (item) => item.path === target.path,
      );
      const latestCandidate = latestTarget?.candidates.find(
        (item) => item.id === candidate.id,
      );
      if (!latestTarget || latestTarget.conflict) {
        setError("磁盘文件已发生变化，已刷新冲突状态。请先处理冲突再切换。");
        return;
      }
      if (
        !latestCandidate ||
        latestCandidate.locked ||
        latestCandidate.archived
      ) {
        setError("缓存方案状态已变化，页面已刷新；请重新选择方案。");
        return;
      }
      setSwitchPreviewOpen(true);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCandidateSwitch() {
    if (
      !target ||
      !candidate ||
      candidate.locked ||
      candidate.archived ||
      dirty ||
      target.conflict
    )
      return;
    const next = await act(
      () => api.lockCandidate(target.path, candidate.id),
      `已设为当前方案「${candidate.name}」，磁盘文件已同步`,
    );
    if (next) setSwitchPreviewOpen(false);
  }

  async function createCandidate(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    const sourceCandidate = candidateSourceId
      ? target.candidates.find((item) => item.id === candidateSourceId)
      : null;
    if (candidateSourceId && !sourceCandidate) {
      setError("所选缓存方案已不存在，请重新选择内容来源。");
      return;
    }
    const sourceContent = sourceCandidate?.content ?? content;
    const preserveCurrentDraft = !!sourceCandidate && dirty;
    const knownIds = new Set(target.candidates.map((item) => item.id));
    const next = await act(
      () => api.createCandidate(target.path, candidateName, sourceContent),
      preserveCurrentDraft
        ? "新缓存方案已创建；当前未保存草稿仍保留在编辑器"
        : "缓存方案已创建；历史版本已记录到本地 Git",
    );
    const created = next?.targets
      .find((item) => item.path === target.path)
      ?.candidates.find((item) => !knownIds.has(item.id));
    if (created && !preserveCurrentDraft) {
      setSelectedCandidateId(created.id);
      setContent(created.content);
      setName(created.name);
    }
    if (created) {
      setShowCandidateForm(false);
      setCandidateName("");
      setCandidateSourceId("");
    }
  }

  async function importCandidateFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !target) return;
    if (!/\.(md|markdown)$/i.test(file.name)) {
      setError("只能从 .md 或 .markdown 文件 Fork 缓存方案。");
      return;
    }
    if (
      dirty &&
      !window.confirm(
        "当前方案有未保存修改，Fork 后将切换到新缓存方案。确定继续吗？",
      )
    )
      return;

    const targetPath = target.path;
    const importedName =
      file.name.replace(/\.(md|markdown)$/i, "").trim() || "Fork 缓存方案";
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
      "已从文件 Fork 新缓存方案；磁盘文件未更改",
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
      "冲突已解决，磁盘文件已与新缓存方案同步",
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
    setHistoryRevisionName(null);
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
        setHistoryRevisionName(version.name ?? null);
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
    setHistoryRevisionName(null);
    setHistoryError("");
    setHistoryLoading(true);
    try {
      const version = await api.candidateRevision(
        historyTargetPath,
        historyCandidate.id,
        revision.commit,
      );
      setHistoryContent(version.content);
      setHistoryRevisionName(version.name ?? null);
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
        "当前编辑器有未保存修改。从历史版本 Fork 缓存方案后将切换编辑器，确定继续吗？",
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
          `${historyRevisionName ?? historyCandidate.name}（历史恢复）`,
          historyContent,
        ),
      "已从历史版本 Fork 新缓存方案；磁盘文件未更改",
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
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await api.saveCandidate(
        target.path,
        candidate.id,
        name,
        content,
        candidate.name,
        candidate.content,
      );
      setState(next);
      setNotice(
        candidate.locked
          ? "当前方案与磁盘文件已同步；历史版本已保存"
          : "历史版本已保存",
      );
      window.setTimeout(() => setNotice(""), 3500);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "CANDIDATE_CHANGED") {
        setError(message(reason));
      } else {
        setError(message(reason));
        await refresh().catch(() => undefined);
      }
    } finally {
      setBusy(false);
      saveInFlight.current = false;
    }
  }

  function exportCurrentCandidate() {
    if (!candidate) return;
    downloadMarkdown(name || candidate.name, content);
  }

  function exportSelectedHistoryRevision() {
    if (historyContent === null) return;
    downloadMarkdown(
      historyRevisionName ?? historyCandidate?.name ?? "candidate",
      historyContent,
    );
  }

  async function copyToClipboard(
    value: string,
    item: "content" | "formal-path" | "resolution",
  ) {
    try {
      await navigator.clipboard.writeText(value);
      setError("");
      setNotice("");
      setCopiedItem(item);
      if (copyFeedbackTimeout.current !== null)
        window.clearTimeout(copyFeedbackTimeout.current);
      copyFeedbackTimeout.current = window.setTimeout(() => {
        setCopiedItem(null);
        copyFeedbackTimeout.current = null;
      }, 1800);
    } catch (reason) {
      setCopiedItem(null);
      setError(`复制到剪贴板失败：${message(reason)}`);
    }
  }

  async function copyCurrentContent() {
    await copyToClipboard(content, "content");
  }

  async function copyFormalPath() {
    if (!target) return;
    await copyToClipboard(formalFilePath(target.path), "formal-path");
  }

  async function copyResolution() {
    await copyToClipboard(resolution, "resolution");
  }

  async function previewLockedCandidateChanges() {
    if (!target || !candidate?.locked || !candidateContentDirty || busy) return;
    const targetPath = target.path;
    const candidateId = candidate.id;
    const savedCandidateContent = candidate.content;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const latest = await api.state();
      const latestTarget = latest.targets.find((item) =>
        samePath(item.path, targetPath),
      );
      const latestCandidate = latestTarget?.candidates.find(
        (item) => item.id === candidateId,
      );
      if (!latestTarget || latestTarget.conflict) {
        setError(
          "磁盘文件已发生变化，未打开预览；当前草稿已保留，请重新扫描并处理冲突。",
        );
        return;
      }
      if (
        !latestCandidate ||
        latestTarget.lockedCandidateId !== candidateId ||
        latestCandidate.archived ||
        latestCandidate.content !== savedCandidateContent
      ) {
        setError(
          "当前方案已在其他窗口变化，未打开预览；当前草稿已保留，请先重新扫描并核对。",
        );
        return;
      }
      setState(latest);
      setCompareBaseId(candidateId);
      setCompareOpen(true);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  function moveToFindMatch(direction: -1 | 1) {
    if (findMatchPositions.length === 0) return;
    const nextMatch =
      activeFindMatch === -1
        ? direction === 1
          ? 0
          : findMatchPositions.length - 1
        : (activeFindMatch + direction + findMatchPositions.length) %
          findMatchPositions.length;
    setActiveFindMatch(nextMatch);
    const start = findMatchPositions[nextMatch];
    const editor = candidateEditor.current;
    if (!editor || start === undefined) return;
    editor.focus();
    editor.setSelectionRange(start, start + findQuery.length);
  }

  function replaceFindMatch(replaceAll: boolean) {
    if (findMatchPositions.length === 0) return;
    if (replaceAll) {
      let nextContent = content;
      for (const position of [...findMatchPositions].reverse()) {
        nextContent =
          nextContent.slice(0, position) +
          replacementText +
          nextContent.slice(position + findQuery.length);
      }
      setContent(nextContent);
      setActiveFindMatch(-1);
      setNotice(`已替换 ${findMatchPositions.length} 处；保存后才会写入文件。`);
      window.setTimeout(() => setNotice(""), 3500);
      return;
    }

    const matchIndex = activeFindMatch < 0 ? 0 : activeFindMatch;
    const position = findMatchPositions[matchIndex];
    if (position === undefined) return;
    setContent(
      content.slice(0, position) +
        replacementText +
        content.slice(position + findQuery.length),
    );
    setActiveFindMatch(-1);
  }

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeout.current !== null)
        window.clearTimeout(copyFeedbackTimeout.current);
    };
  }, []);

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

  useEffect(() => {
    function openRuleSearchFromKeyboard(event: KeyboardEvent) {
      if (
        !(event.ctrlKey || event.metaKey) ||
        !event.shiftKey ||
        event.key.toLowerCase() !== "f"
      )
        return;
      event.preventDefault();
      if (
        starting ||
        busy ||
        ruleSearchOpen ||
        helpOpen ||
        showInitializeForm ||
        switchPreviewOpen ||
        compareOpen ||
        historyOpen ||
        showRenameCandidateForm ||
        showCandidateForm ||
        showWorkspaceForm
      )
        return;
      setRuleSearchOpen(true);
    }
    window.addEventListener("keydown", openRuleSearchFromKeyboard);
    return () =>
      window.removeEventListener("keydown", openRuleSearchFromKeyboard);
  }, [
    busy,
    compareOpen,
    helpOpen,
    historyOpen,
    ruleSearchOpen,
    showRenameCandidateForm,
    showCandidateForm,
    showInitializeForm,
    showWorkspaceForm,
    starting,
    switchPreviewOpen,
  ]);

  useEffect(() => {
    function closeTopmostDialog(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (ruleSearchOpen) setRuleSearchOpen(false);
      else if (helpOpen) setHelpOpen(false);
      else if (showInitializeForm) setShowInitializeForm(false);
      else if (switchPreviewOpen) setSwitchPreviewOpen(false);
      else if (compareOpen) setCompareOpen(false);
      else if (historyOpen) setHistoryOpen(false);
      else if (findReplaceOpen) setFindReplaceOpen(false);
      else if (showRenameCandidateForm) setShowRenameCandidateForm(false);
      else if (showCandidateForm) setShowCandidateForm(false);
      else if (showWorkspaceForm) setShowWorkspaceForm(false);
      else return;
      event.preventDefault();
    }

    window.addEventListener("keydown", closeTopmostDialog);
    return () => window.removeEventListener("keydown", closeTopmostDialog);
  }, [
    compareOpen,
    helpOpen,
    ruleSearchOpen,
    historyOpen,
    findReplaceOpen,
    switchPreviewOpen,
    showRenameCandidateForm,
    showCandidateForm,
    showInitializeForm,
    showWorkspaceForm,
  ]);

  useEffect(() => {
    if (!dirty && !resolutionDirty) return;

    function protectUnsavedDraft(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", protectUnsavedDraft);
    return () =>
      window.removeEventListener("beforeunload", protectUnsavedDraft);
  }, [dirty, resolutionDirty]);

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
            <small>本地文件管理</small>
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
          {state.workspaces.map((workspace) => {
            const name = pathLeaf(workspace);
            const disambiguated = duplicateWorkspaceNames.has(
              name.toLowerCase(),
            );
            return (
              <div className="workspace-item" key={workspace}>
                <button
                  className={`workspace-row ${workspace === selectedWorkspace ? "active" : ""} ${disambiguated ? "has-path-context" : ""}`}
                  onClick={() => chooseWorkspace(workspace)}
                  title={workspace}
                  aria-label={
                    disambiguated ? workspaceLabel(workspace) : undefined
                  }
                >
                  <FolderOpen size={15} />
                  <span className="workspace-label">
                    <span className="workspace-name-line">
                      {name}
                      {samePath(workspace, userWorkspace ?? "") ? (
                        <em>用户文件</em>
                      ) : null}
                    </span>
                    {disambiguated ? (
                      <small>{workspaceParentContext(workspace)}</small>
                    ) : null}
                  </span>
                  {samePath(workspace, selectedWorkspace) ? (
                    <ChevronRight size={14} />
                  ) : null}
                </button>
                {!samePath(workspace, userWorkspace ?? "") ? (
                  <button
                    className="workspace-remove"
                    aria-label={`从列表移除工作空间 ${workspaceLabel(workspace)}`}
                    title={`从列表移除${workspaceLabel(workspace)}（保留磁盘文件、缓存方案和历史版本）`}
                    disabled={busy}
                    onClick={() => void removeWorkspace(workspace)}
                  >
                    <FolderMinus size={14} />
                  </button>
                ) : null}
              </div>
            );
          })}
          {state.workspaces.length === 0 && (
            <div className="empty-note">还没有工作空间</div>
          )}
        </div>

        <div className="section-heading rule-heading">
          <span>文件</span>
          <div className="heading-actions">
            <span className="count">{workspaceTargets.length}</span>
            {selectedWorkspace ? (
              <>
                <button
                  className="icon-button"
                  aria-label="初始化目录"
                  title="在当前工作空间中创建磁盘文件"
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
              aria-label="筛选文件路径"
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
                className={`rule-dot ${item.conflict ? "conflict" : "ready"}`}
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
              <strong>没有发现磁盘文件 AGENTS.md</strong>
              <span>
                工作空间已登记，可以在根目录创建磁盘文件和首个缓存方案。
              </span>
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    () => api.initializePath(selectedWorkspace),
                    "磁盘文件和首个缓存方案已建立并同步",
                  )
                }
              >
                初始化磁盘文件 AGENTS.md
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
          <div className="topbar-tools">
            <button
              className="secondary-button rule-search-trigger"
              aria-label="搜索全部文件"
              aria-keyshortcuts="Control+Shift+F Meta+Shift+F"
              title="搜索所有已扫描路径中的磁盘文件和方案正文（Ctrl+Shift+F）"
              disabled={starting || busy}
              onClick={() => setRuleSearchOpen(true)}
            >
              <Search size={14} />
              搜索全部文件
            </button>
            <div className="topbar-status">
              <span className={`live-dot ${starting ? "is-pulsing" : ""}`} />
              {starting
                ? hasInitialState
                  ? `正在后台扫描 ${state.workspaces.length} 个工作空间`
                  : "正在读取本地状态…"
                : "仅本机运行"}
            </div>
          </div>
        </header>

        {!target ? (
          <section className="welcome-page">
            <div className="welcome-symbol">
              <FileCode2 size={30} />
            </div>
            <p className="eyebrow">AGENT INSTRUCTION VARIANTS</p>
            <h1>
              一份 AGENTS.md，<span>多个提示词方案，随时切换。</span>
            </h1>
            <p>
              想尝试不同版本，不必手动备份、复制或覆盖文件。分别保存多个缓存方案，选中并确认差异后即可切换。
              <br />
              磁盘文件和缓存方案都只保存在你的设备上。
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
        ) : target.conflict ? (
          <section className="page-content">
            <div className="page-title">
              <div>
                <p className="eyebrow">{relativePath}</p>
                <h1>检测到磁盘文件与当前方案不一致</h1>
                <p>
                  外部程序可以照常编辑磁盘文件。PromptDock
                  会显示差异并提供合并处理；解决前暂缓在这里切换方案。
                </p>
              </div>
              <span className="status danger">
                <AlertTriangle size={14} />
                需要处理
              </span>
            </div>
            <div className="conflict-view-toolbar">
              <span>
                当前方案 → 磁盘文件 · 新增 {conflictLineCounts.added} 行 · 删除{" "}
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
                ariaLabel="磁盘文件与当前方案的行差异"
                emptyMessage="没有可显示的文本差异；请检查磁盘文件或当前方案是否缺失。"
              />
            ) : (
              <div className="conflict-grid">
                <div className="compare-panel">
                  <label>磁盘文件</label>
                  <pre>{target.formalContent ?? "磁盘文件已被删除"}</pre>
                </div>
                <div className="compare-panel">
                  <label>当前方案</label>
                  <pre>{lockedCandidate?.content ?? "当前方案不存在"}</pre>
                </div>
              </div>
            )}
            <div className="resolution-toolbar">
              <button onClick={() => setResolution(target.formalContent ?? "")}>
                把磁盘文件放入解决稿
              </button>
              <button
                onClick={() =>
                  setResolution(
                    target.candidates.find((item) => item.locked)?.content ??
                      "",
                  )
                }
              >
                把当前方案放入解决稿
              </button>
              {dirty ? (
                <button onClick={() => setResolution(content)}>
                  把未保存草稿放入解决稿
                </button>
              ) : null}
              <input
                aria-label="冲突方案名称"
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
              <span className="resolution-save-info">
                <span>
                  确认后会生成新缓存方案，将它设为当前方案并写入磁盘文件。
                </span>
                <small
                  data-testid="resolution-content-stats"
                  title="行数按换行拆分；空文档计 1 行，结尾换行会保留空行。字符数按 Unicode 码点计数；字节数按 UTF-8 编码计算。"
                >
                  {resolutionMetrics.lines} 行 · {resolutionMetrics.characters}{" "}
                  字符 · {resolutionMetrics.utf8Bytes} UTF-8 字节
                </small>
              </span>
              <button
                className="secondary-button"
                title="复制当前冲突解决稿，包括未保存修改"
                onClick={() => void copyResolution()}
              >
                {copiedItem === "resolution" ? (
                  <Check size={14} />
                ) : (
                  <Copy size={14} />
                )}
                {copiedItem === "resolution" ? "已复制解决稿" : "复制解决稿"}
              </button>
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
          <section className="page-content workspace-editor-page">
            <div className="page-title">
              <div>
                <p className="eyebrow">{relativePath}</p>
                <h1>Agent 指令方案</h1>
                <p>
                  为同一份 AGENTS.md
                  保存多套提示词；想尝试其他版本时，选中方案并确认差异即可切换。
                </p>
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
                  <span>缓存方案</span>
                  <div className="candidate-heading-actions">
                    {candidate &&
                    ((!candidate.locked && lockedCandidate) ||
                      (candidate.locked &&
                        (candidateContentDirty ||
                          target.candidates.some(
                            (item) => item.id !== candidate.id,
                          )))) ? (
                      <button
                        aria-label={
                          candidate.locked && candidateContentDirty
                            ? "预览待同步差异"
                            : "与其他缓存方案对比"
                        }
                        title={
                          candidate.locked && candidateContentDirty
                            ? "只读预览当前草稿与当前方案（与磁盘同步）的差异；保存前不会修改文件"
                            : "将当前编辑器内容与其他缓存方案并排查看"
                        }
                        disabled={busy}
                        onClick={() => {
                          if (candidate.locked && candidateContentDirty) {
                            void previewLockedCandidateChanges();
                          } else {
                            const otherCandidate =
                              target.candidates.find(
                                (item) =>
                                  item.id !== candidate.id && !item.archived,
                              ) ??
                              target.candidates.find(
                                (item) => item.id !== candidate.id,
                              );
                            setCompareBaseId(
                              candidate.locked
                                ? (otherCandidate?.id ?? "")
                                : (lockedCandidate?.id ?? ""),
                            );
                            setCompareOpen(true);
                          }
                        }}
                      >
                        <GitCompare size={14} />
                      </button>
                    ) : null}
                    <button
                      aria-label="查看历史版本"
                      title="查看此方案的历史版本"
                      disabled={busy || historyLoading}
                      onClick={() => void openCandidateHistory()}
                    >
                      <Clock3 size={14} />
                    </button>
                    <button
                      aria-label="新建缓存方案"
                      title="新建缓存方案"
                      disabled={busy}
                      onClick={() => {
                        setCandidateSourceId("");
                        setShowCandidateForm(true);
                      }}
                    >
                      <Plus size={15} />
                    </button>
                    <button
                      aria-label="从 Markdown Fork 缓存方案"
                      title="从 Markdown 文件 Fork 一个缓存方案；来源文件和磁盘文件都不会被修改"
                      disabled={busy || target.conflict}
                      onClick={() => candidateFileInput.current?.click()}
                    >
                      <GitFork size={14} />
                    </button>
                    <input
                      ref={candidateFileInput}
                      aria-label="选择 Markdown 文件以 Fork 缓存方案"
                      type="file"
                      accept=".md,.markdown,text/markdown,text/plain"
                      hidden
                      onChange={(event) => void importCandidateFile(event)}
                    />
                  </div>
                </div>
                {candidate ? (
                  <div className="cache-plan-actions">
                    <button
                      type="button"
                      aria-label="重命名选中的缓存方案"
                      disabled={busy || dirty || target.conflict}
                      onClick={() => {
                        setRenameCandidateName(candidate.name);
                        setShowRenameCandidateForm(true);
                      }}
                    >
                      <PencilLine size={14} />
                      重命名
                    </button>
                    <button
                      type="button"
                      className="delete-cache-button"
                      aria-label="删除选中的缓存方案"
                      disabled={
                        busy || dirty || target.conflict || candidate.locked
                      }
                      title={
                        candidate.locked ? "当前方案不能删除" : "删除此缓存方案"
                      }
                      onClick={() => void deleteCurrentCandidate()}
                    >
                      <Trash2 size={14} />
                      删除
                    </button>
                  </div>
                ) : null}
                <label className="candidate-filter">
                  <Search size={12} />
                  <input
                    aria-label="筛选缓存方案"
                    placeholder="搜索方案名称或内容"
                    value={candidateFilter}
                    onChange={(event) => setCandidateFilter(event.target.value)}
                  />
                </label>
                <button
                  className="archive-filter-button"
                  aria-label={
                    showArchivedCandidates ? "返回当前方案" : "查看已归档方案"
                  }
                  disabled={
                    busy ||
                    (!showArchivedCandidates &&
                      !(
                        target?.candidates.some((item) => item.archived) ??
                        false
                      ))
                  }
                  onClick={() => setShowArchivedCandidates((value) => !value)}
                >
                  {showArchivedCandidates ? (
                    <ArchiveRestore size={13} />
                  ) : (
                    <Archive size={13} />
                  )}
                  {showArchivedCandidates
                    ? "返回当前方案"
                    : `已归档 (${target?.candidates.filter((item) => item.archived).length ?? 0})`}
                </button>
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
                        <small>
                          {item.locked
                            ? "当前方案"
                            : item.archived
                              ? "已归档"
                              : "缓存方案"}
                          {(candidateNameCounts.get(
                            item.name.trim().toLowerCase(),
                          ) ?? 0) > 1
                            ? ` · ${item.id.slice(0, 7)}`
                            : ""}
                        </small>
                      </span>
                      {item.locked ? (
                        <span className="lock-mark">
                          <Check size={12} />
                        </span>
                      ) : null}
                    </button>
                  ))}
                  {visibleCandidates.length === 0 ? (
                    <p className="candidate-list-empty">没有匹配的缓存方案。</p>
                  ) : null}
                </div>
                {candidate && candidate.archived ? (
                  <button
                    className="switch-button"
                    disabled={busy || dirty || target.conflict}
                    onClick={() => void restoreCurrentCandidate()}
                  >
                    <ArchiveRestore size={14} />
                    恢复缓存方案
                  </button>
                ) : candidate && !candidate.locked ? (
                  <div className="candidate-actions">
                    <button
                      className="switch-button"
                      disabled={busy || dirty || target.conflict}
                      onClick={() => void openCandidateSwitchPreview()}
                    >
                      <ArrowDownUp size={14} />
                      切换当前方案并同步磁盘文件
                    </button>
                    <button
                      className="archive-candidate-button"
                      aria-label="归档当前方案"
                      title="从当前方案列表收起；正文和历史保留"
                      disabled={busy || dirty || target.conflict}
                      onClick={() => void archiveCurrentCandidate()}
                    >
                      <Archive size={14} />
                      归档
                    </button>
                  </div>
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
                      与磁盘同步
                    </span>
                  ) : candidate?.archived ? (
                    <span className="draft-tag">已归档 · 只读</span>
                  ) : (
                    <span className="draft-tag">方案草稿</span>
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
                      disabled={candidate?.archived ?? false}
                      title={candidate?.archived ? "已归档方案只读" : undefined}
                      onClick={() => setPreviewMode(false)}
                    >
                      {candidate?.archived ? (
                        <Eye size={12} />
                      ) : (
                        <PencilLine size={12} />
                      )}
                      {candidate?.archived ? "只读" : "编辑"}
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
                  <button
                    type="button"
                    className="secondary-button editor-find-toggle"
                    aria-expanded={findReplaceOpen}
                    disabled={
                      !candidate || candidate.archived || previewMode || busy
                    }
                    onClick={() => {
                      setFindReplaceOpen((open) => !open);
                      setActiveFindMatch(-1);
                    }}
                  >
                    <Search size={12} />
                    查找替换
                  </button>
                </div>
                {findReplaceOpen ? (
                  <div
                    className="editor-find-replace"
                    role="group"
                    aria-label="查找替换方案内容"
                  >
                    <input
                      aria-label="查找方案内容"
                      placeholder="查找文本"
                      title="只查找当前方案，按原文区分大小写"
                      value={findQuery}
                      onChange={(event) => {
                        setFindQuery(event.target.value);
                        setActiveFindMatch(-1);
                      }}
                    />
                    <input
                      aria-label="替换为"
                      placeholder="替换为"
                      title="替换结果只修改当前草稿；保存方案后才会写入文件"
                      value={replacementText}
                      onChange={(event) =>
                        setReplacementText(event.target.value)
                      }
                    />
                    <span aria-live="polite">
                      {findMatchPositions.length === 0
                        ? "没有匹配"
                        : activeFindMatch >= 0
                          ? `第 ${activeFindMatch + 1} / ${findMatchPositions.length} 处`
                          : `找到 ${findMatchPositions.length} 处`}
                    </span>
                    <button
                      type="button"
                      aria-label="上一个匹配"
                      title="上一个匹配"
                      disabled={findMatchPositions.length === 0}
                      onClick={() => moveToFindMatch(-1)}
                    >
                      <ChevronRight className="find-previous-icon" size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label="下一个匹配"
                      title="下一个匹配"
                      disabled={findMatchPositions.length === 0}
                      onClick={() => moveToFindMatch(1)}
                    >
                      <ChevronRight size={13} />
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      title="替换当前匹配；只修改草稿"
                      disabled={
                        findMatchPositions.length === 0 ||
                        candidate?.archived ||
                        busy
                      }
                      onClick={() => replaceFindMatch(false)}
                    >
                      替换当前
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      title="替换当前方案中的全部匹配；只修改草稿"
                      disabled={
                        findMatchPositions.length === 0 ||
                        candidate?.archived ||
                        busy
                      }
                      onClick={() => replaceFindMatch(true)}
                    >
                      全部替换
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="关闭查找替换"
                      onClick={() => setFindReplaceOpen(false)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : null}
                <div
                  className="editor-view"
                  id="candidate-editor-view"
                  aria-label={previewMode ? "Markdown 预览" : "方案编辑器"}
                >
                  {candidate ? (
                    previewMode ? (
                      <div className="candidate-name-preview">{name}</div>
                    ) : (
                      <input
                        className="candidate-name"
                        aria-label="方案名称"
                        value={name}
                        readOnly={candidate.archived}
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
                      ref={candidateEditor}
                      className="markdown-editor"
                      aria-label="方案内容"
                      spellCheck={false}
                      value={content}
                      readOnly={candidate?.archived ?? false}
                      onChange={(event) => setContent(event.target.value)}
                    />
                  )}
                </div>
                <div className="editor-footer">
                  <div className="editor-footer-message">
                    <span
                      data-testid="candidate-content-stats"
                      title="行数按换行拆分；空文档计 1 行，结尾换行会保留空行。字符数按 Unicode 码点计数；字节数按 UTF-8 编码计算。"
                    >
                      {dirty ? "有未保存更改" : "所有更改已保存"} ·{" "}
                      {contentMetrics.lines} 行 · {contentMetrics.characters}{" "}
                      字符 · {contentMetrics.utf8Bytes} UTF-8 字节
                    </span>
                    {candidate?.locked && dirty ? (
                      <span
                        className="formal-sync-impact"
                        data-testid="formal-sync-impact"
                        aria-live="polite"
                      >
                        {formalSyncImpact.added === 0 &&
                        formalSyncImpact.removed === 0
                          ? "正文与磁盘文件一致；本次只改方案名称"
                          : `保存并同步将新增 ${formalSyncImpact.added} 行、删除 ${formalSyncImpact.removed} 行`}
                      </span>
                    ) : null}
                  </div>
                  <div className="heading-actions">
                    <button
                      className="secondary-button"
                      disabled={!candidate}
                      title="复制当前编辑器内容，包括未保存修改"
                      onClick={() => void copyCurrentContent()}
                    >
                      {copiedItem === "content" ? (
                        <Check size={14} />
                      ) : (
                        <Copy size={14} />
                      )}
                      {copiedItem === "content" ? "已复制" : "复制内容"}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={!candidate}
                      title="导出当前编辑器内容，包括未保存修改"
                      onClick={exportCurrentCandidate}
                    >
                      <Download size={14} />
                      导出 Markdown
                    </button>
                    {dirty ? (
                      <button
                        className="secondary-button"
                        disabled={busy}
                        title="还原此方案最近保存的名称和正文"
                        onClick={() => {
                          if (
                            !window.confirm(
                              "放弃当前未保存修改，并还原此方案最近保存的名称和正文吗？",
                            )
                          )
                            return;
                          setContent(candidate?.content ?? "");
                          setName(candidate?.name ?? "");
                        }}
                      >
                        <RotateCcw size={14} />
                        还原已保存内容
                      </button>
                    ) : null}
                    <button
                      className="primary-button"
                      disabled={
                        busy || !candidate || candidate.archived || !dirty
                      }
                      title={`保存方案（${navigator.platform.toLowerCase().includes("mac") ? "⌘S" : "Ctrl+S"}）`}
                      aria-keyshortcuts="Control+S Meta+S"
                      onClick={() => void saveCurrentCandidate()}
                    >
                      <Save size={15} />
                      {candidate?.locked
                        ? "保存当前方案并同步磁盘文件"
                        : "保存方案"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="formal-card">
              <div>
                <FileCode2 size={15} />
                <span>
                  <small>磁盘文件位置</small>
                  <strong>{shortPath(formalFilePath(target.path))}</strong>
                </span>
                <button
                  className="formal-path-copy"
                  title="复制完整磁盘文件路径到剪贴板"
                  onClick={() => void copyFormalPath()}
                >
                  {copiedItem === "formal-path" ? (
                    <Check size={13} />
                  ) : (
                    <Copy size={13} />
                  )}
                  {copiedItem === "formal-path" ? "路径已复制" : "复制路径"}
                </button>
              </div>
              {target.conflict ? (
                <span className="formal-match formal-conflict">
                  <AlertTriangle size={13} />
                  磁盘文件与当前方案不一致
                </span>
              ) : (
                <span className="formal-match">
                  <Check size={13} />
                  磁盘与当前方案一致
                </span>
              )}
            </div>
          </section>
        )}

        <footer className="app-footer">
          <span>PromptDock · 你的本地文件不会上传</span>
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

      {ruleSearchOpen ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.currentTarget === event.target && setRuleSearchOpen(false)
          }
        >
          <section
            className="modal-card rule-search-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rule-search-title"
          >
            <div className="modal-title">
              <div>
                <p className="eyebrow">只读搜索 · 不修改文件</p>
                <h2 id="rule-search-title">搜索全部文件</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭文件搜索"
                onClick={() => setRuleSearchOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <label className="rule-search-input">
              <Search size={15} />
              <input
                autoFocus
                aria-label="搜索文件正文"
                placeholder="输入要查找的文件文字"
                value={ruleSearchQuery}
                onChange={(event) => setRuleSearchQuery(event.target.value)}
              />
            </label>
            <p className="modal-description">
              搜索所有已扫描路径中的磁盘文件和方案正文，包含已归档方案。相同的磁盘文件与当前方案只显示一次；冲突两侧会分别显示。
            </p>
            <div className="rule-search-results" aria-live="polite">
              {!normalizedRuleSearchQuery ? (
                <p className="history-empty">输入文字开始搜索。</p>
              ) : ruleSearchResults.length === 0 ? (
                <p className="history-empty">没有匹配的文件正文。</p>
              ) : (
                <>
                  <p className="rule-search-count">
                    找到 {ruleSearchResults.length} 个匹配项
                  </p>
                  {ruleSearchResults.map((result) => (
                    <button
                      key={result.key}
                      className="rule-search-result"
                      title={result.targetPath}
                      aria-label={`${result.label}，${result.targetPath}：${result.excerptBefore}${result.excerptMatch}${result.excerptAfter}`}
                      disabled={starting || busy}
                      onClick={() => openRuleSearchResult(result)}
                    >
                      <span className="rule-search-result-heading">
                        <strong>{result.label}</strong>
                        <small>{shortPath(result.targetPath, 4)}</small>
                      </span>
                      <span className="rule-search-excerpt">
                        {result.excerptBefore}
                        <mark>{result.excerptMatch}</mark>
                        {result.excerptAfter}
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setRuleSearchOpen(false)}
              >
                关闭
              </button>
            </div>
          </section>
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
              选择一个本机目录，添加后会扫描该目录及其所有子目录。
            </p>
            <label className="field-label">
              文件夹路径
              <span className="path-picker-field">
                <input
                  autoFocus
                  required
                  placeholder="选择文件夹，或输入本机路径"
                  value={workspaceInput}
                  onChange={(event) => setWorkspaceInput(event.target.value)}
                />
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void chooseWorkspaceDirectory()}
                >
                  <FolderOpen size={14} />
                  浏览…
                </button>
              </span>
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

      {showRenameCandidateForm && candidate ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.currentTarget === event.target &&
            setShowRenameCandidateForm(false)
          }
        >
          <form
            className="modal-card"
            onSubmit={(event) => void renameCurrentCandidate(event)}
          >
            <div className="modal-title">
              <div>
                <p className="eyebrow">缓存方案</p>
                <h2>重命名</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭重命名窗口"
                onClick={() => setShowRenameCandidateForm(false)}
              >
                <X size={16} />
              </button>
            </div>
            <label className="field-label">
              新名称
              <input
                autoFocus
                required
                aria-label="缓存方案新名称"
                value={renameCandidateName}
                onChange={(event) => setRenameCandidateName(event.target.value)}
              />
            </label>
            <p className="modal-description">
              重命名会记入本机历史，不会更改方案正文或磁盘文件。
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowRenameCandidateForm(false)}
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={
                  busy ||
                  !renameCandidateName.trim() ||
                  renameCandidateName.trim() === candidate.name
                }
              >
                <PencilLine size={14} />
                保存名称
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
                <p className="eyebrow">缓存方案</p>
                <h2>创建缓存方案</h2>
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
              方案名称
              <input
                autoFocus
                required
                placeholder="例如：更严格的代码审查"
                aria-label="新方案名称"
                value={candidateName}
                onChange={(event) => setCandidateName(event.target.value)}
              />
            </label>
            <label className="field-label">
              方案内容来源
              <select
                aria-label="方案内容来源"
                value={candidateSourceId}
                onChange={(event) => setCandidateSourceId(event.target.value)}
              >
                <option value="">当前编辑器（含未保存修改）</option>
                {target?.candidates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.id.slice(0, 7)}
                    {item.locked ? "（与磁盘同步）" : ""}
                    {item.archived ? "（已归档）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <p className="modal-description">
              {candidateSourceId && dirty
                ? "将从所选缓存方案 Fork；当前编辑器中的未保存草稿会保留。"
                : candidateSourceId
                  ? "将从所选缓存方案 Fork，并在创建后打开。"
                  : "将编辑器当前内容（包括未保存修改）复制为新方案；创建后可单独编辑和比较。"}
            </p>
            {selectedSourceCandidate ? (
              <details className="candidate-source-preview">
                <summary>预览已保存来源正文（只读）</summary>
                <pre>{selectedSourceCandidate.content || "（空文档）"}</pre>
              </details>
            ) : null}
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
                创建缓存方案
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
                <h2>{historyCandidate?.name ?? "缓存方案"} 的历史版本</h2>
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
              对比基准：所选历史版本；对比对象：当前编辑器（含未保存修改）。历史版本只读；从历史版本
              Fork 缓存方案不会改写历史记录或磁盘文件。
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
                  <p className="history-empty">这个缓存方案还没有历史版本。</p>
                ) : null}
              </div>
              <div className="history-version-view">
                <div className="history-preview-toolbar">
                  <span>
                    当前草稿相较历史版本 · 新增 {historyLineCounts.added} 行 ·
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
                <p className="history-revision-name">
                  历史版本名称：
                  {historyRevisionName ?? "此历史版本未单独记录名称"}
                </p>
                {historyContent === null ? (
                  <pre className="history-preview">
                    {historyLoading ? "正在读取历史版本…" : "选择一个历史版本"}
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
                type="button"
                className="secondary-button"
                disabled={historyLoading || historyContent === null}
                onClick={exportSelectedHistoryRevision}
              >
                <Download size={14} />
                导出此历史版本
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
                Fork 此历史版本为缓存方案
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {switchPreviewOpen && target && candidate && !candidate.locked ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.currentTarget === event.target && setSwitchPreviewOpen(false)
          }
        >
          <section className="modal-card switch-preview-modal">
            <div className="modal-title">
              <div>
                <p className="eyebrow">磁盘文件写入预览</p>
                <h2>确认切换当前方案并同步磁盘文件</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭切换预览"
                onClick={() => setSwitchPreviewOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p className="modal-description">
              将用已保存方案「{candidate.name}」覆盖磁盘文件
              <code>{formalFilePath(target.path)}</code>
              ，并把它设为当前方案。此操作保留其他缓存方案和历史版本。
            </p>
            <div className="switch-preview-summary">
              <span>{candidate.name} → 磁盘文件</span>
              <span>
                新增 {switchLineCounts.added} 行 · 删除{" "}
                {switchLineCounts.removed} 行
              </span>
            </div>
            <LineDiffView
              changes={switchChanges}
              ariaLabel="磁盘文件切换差异"
              emptyMessage="方案正文与磁盘文件完全一致；切换只会更新当前方案。"
              className="conflict-diff switch-preview-diff"
            />
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setSwitchPreviewOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy || dirty || target.conflict}
                onClick={() => void confirmCandidateSwitch()}
              >
                <ArrowDownUp size={14} />
                确认切换当前方案并同步磁盘文件
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
                <h2>
                  {candidate.locked && candidateContentDirty
                    ? "方案修改同步预览"
                    : "缓存方案对比"}
                </h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭方案对比"
                onClick={() => setCompareOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p className="modal-description">
              {candidate.locked && candidateContentDirty
                ? "左侧是待同步的正文草稿；右侧是当前方案已保存的内容。此窗口只读，磁盘文件要到点击保存时才会更新。"
                : dirty
                  ? "左侧显示当前编辑器内容（含未保存修改）；右侧显示已保存的基准方案。此窗口只读。"
                  : "此窗口不会修改任何文件。"}
            </p>
            <label className="compare-base">
              对比基准
              <select
                aria-label="对比基准"
                value={compareBase.id}
                onChange={(event) => setCompareBaseId(event.target.value)}
              >
                {target?.formalContent !== null ? (
                  <optgroup label="磁盘">
                    <option value="__disk__">AGENTS.md</option>
                  </optgroup>
                ) : null}
                <optgroup label="缓存方案">
                  {target?.candidates
                    .filter(
                      (item) =>
                        !item.archived &&
                        (item.id !== candidate.id ||
                          (candidate.locked && candidateContentDirty)),
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.id === candidate.id
                          ? "（当前方案的已保存内容）"
                          : item.locked
                            ? "（与磁盘同步）"
                            : ""}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="已归档">
                  {target?.candidates
                    .filter((item) => item.archived && item.id !== candidate.id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </optgroup>
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
                aria-label="方案对比查看方式"
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
                emptyMessage="两个方案的正文完全一致。"
                className="conflict-diff candidate-compare-diff"
              />
            ) : (
              <div className="compare-columns">
                <section className="compare-column">
                  <header>
                    <strong>{candidate.name}</strong>
                    <span>{dirty ? "当前草稿" : "缓存方案"}</span>
                  </header>
                  <pre>{content}</pre>
                </section>
                <section className="compare-column">
                  <header>
                    <strong>{compareBase.name}</strong>
                    <span>
                      {compareBase.id === "__disk__"
                        ? "磁盘文件"
                        : compareBase.archived
                          ? "已归档方案"
                          : compareBase.locked
                            ? "当前方案（与磁盘同步）"
                            : "缓存方案"}
                    </span>
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
                返回缓存方案
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
                "磁盘文件和首个缓存方案已建立并同步",
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
                <p className="eyebrow">新建文件路径</p>
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
                初始化并同步
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
              用户文件路径：<code>{state.userRulesPath || "尚未检测到"}</code>
            </p>
            <p>
              本地诊断日志：<code>{state.diagnosticsPath || "尚未生成"}</code>
            </p>
            <p>
              工作空间目录通过粘贴本机路径添加。磁盘文件保存在目标路径；缓存方案和
              Git 历史保存在本机数据目录。当前方案与磁盘文件保持一致。
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

function downloadMarkdown(name: string, content: string) {
  const safeName = name
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

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export default App;
