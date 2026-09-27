import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  Candidate,
  CandidateRevision,
  ManagerState,
  RulePath,
} from "../shared/contracts.js";
import { applicationDataDirectory, userRulesFile } from "./settings.js";

const execute = promisify(execFile);

type SavedCandidate = {
  id: string;
  name: string;
  file: string;
  archived?: boolean;
};
type SavedTarget = {
  lockedCandidateId: string | null;
  candidates: SavedCandidate[];
};
type StoredState = {
  workspaces: string[];
  targets: Record<string, SavedTarget>;
};
type CandidateRevisionSnapshot = {
  revisionId: string;
  name: string;
};

export class CandidateChangedError extends Error {
  readonly code = "CANDIDATE_CHANGED";

  constructor() {
    super(
      "此缓存方案已在其他窗口保存新内容。当前草稿未覆盖任何内容；请新建缓存方案保留这份草稿，或重新载入最新内容。",
    );
    this.name = "CandidateChangedError";
  }
}

export class PromptLibrary {
  readonly dataDirectory = applicationDataDirectory();
  readonly historyDirectory = path.join(this.dataDirectory, "library");
  readonly candidateDirectory = path.join(this.historyDirectory, "candidates");
  readonly stateFile = path.join(this.historyDirectory, "manager.json");
  readonly diagnosticsFile = path.join(
    this.dataDirectory,
    "logs",
    "promptdock.jsonl",
  );
  private state: StoredState = { workspaces: [], targets: {} };
  private mutationQueue: Promise<void> = Promise.resolve();

  async open(): Promise<ManagerState> {
    await fs.mkdir(this.candidateDirectory, { recursive: true });
    await fs.mkdir(path.dirname(this.diagnosticsFile), { recursive: true });
    this.state = await this.readState();
    await this.addDefaultUserWorkspace();
    return this.view();
  }

  async getState() {
    return this.view();
  }

  async getFormalStatus(selectedPath: string) {
    const targetPath = Object.keys(this.state.targets).find((item) =>
      this.samePath(item, selectedPath),
    );
    if (!targetPath) return null;
    const stored = this.state.targets[targetPath];
    return {
      path: targetPath,
      formalContent: await this.formalContent(targetPath),
      conflict: this.isConflict(targetPath, stored),
    };
  }

  async addWorkspace(selectedPath: string) {
    return this.exclusively(async () => {
      const workspace = await this.existingDirectory(selectedPath);
      if (
        !this.state.workspaces.some((item) => this.samePath(item, workspace))
      ) {
        this.state.workspaces.push(workspace);
        await this.persist();
        await this.record("添加工作空间");
      }
      await this.scanWorkspace(workspace);
      await this.log("workspace.add", "ok", `path=${workspace}`);
      return this.view();
    });
  }

  async removeWorkspace(selectedPath: string) {
    return this.exclusively(async () => {
      if (!selectedPath.trim()) throw new Error("未指定要移除的工作空间。");
      const requested = path.resolve(selectedPath.trim());
      const workspace = this.state.workspaces.find((item) =>
        this.samePath(item, requested),
      );
      if (!workspace) throw new Error("该工作空间当前未登记。");
      if (this.samePath(workspace, path.dirname(userRulesFile()))) {
        throw new Error("Codex 用户级规则路径由应用自动管理，不能移除。");
      }

      const previousWorkspaces = [...this.state.workspaces];
      this.state.workspaces = this.state.workspaces.filter(
        (item) => !this.samePath(item, workspace),
      );
      try {
        await this.persist();
        await this.record("从列表移除工作空间");
      } catch (error) {
        this.state.workspaces = previousWorkspaces;
        await this.persist().catch(() => undefined);
        throw error;
      }
      await this.log("workspace.remove", "ok", `path=${workspace}`);
      return this.view();
    });
  }

  async rescanWorkspace(selectedPath: string) {
    return this.exclusively(async () => {
      const workspace = await this.authorizedDirectory(selectedPath);
      const started = Date.now();
      await this.log("workspace.scan", "started", `path=${workspace}`);
      await this.scanWorkspace(workspace);
      await this.log(
        "workspace.scan",
        "ok",
        `path=${workspace} elapsed_ms=${Date.now() - started}`,
      );
      return this.view();
    });
  }

  async scanAllWorkspaces() {
    return this.exclusively(async () => {
      const started = Date.now();
      const failures: string[] = [];
      for (const workspace of [...this.state.workspaces]) {
        try {
          await this.scanWorkspace(workspace);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          failures.push(`${workspace}: ${message}`);
          await this.log("workspace.scan_all", "error", failures.at(-1));
        }
      }
      if (failures.length) {
        throw new Error(
          `有 ${failures.length} 个工作空间扫描失败：${failures.join("；")}`,
        );
      }
      await this.log(
        "workspace.scan_all",
        "ok",
        `count=${this.state.workspaces.length} elapsed_ms=${Date.now() - started}`,
      );
      return this.view();
    });
  }

  async initializePath(selectedPath: string) {
    return this.exclusively(async () => {
      const targetPath = await this.authorizedDirectory(selectedPath);
      if ((await this.formalContent(targetPath)) !== null) {
        throw new Error(
          "该目录已有 AGENTS.md。请先扫描并导入，避免初始化时覆盖现有内容。",
        );
      }
      if (this.state.targets[targetPath]) {
        throw new Error("该路径已经初始化。");
      }

      const target: SavedTarget = {
        lockedCandidateId: null,
        candidates: [],
      };
      const content = "# AGENTS.md\n";
      this.state.targets[targetPath] = target;
      let formalWritten = false;
      try {
        const candidate = await this.createSavedCandidate(
          target,
          "初始缓存方案",
          content,
        );
        target.lockedCandidateId = candidate.id;
        if ((await this.formalContent(targetPath)) !== null) {
          throw new Error("磁盘文件在初始化期间已被其他程序创建。请重新扫描。");
        }
        await this.writeFormal(targetPath, content);
        formalWritten = true;
        await this.persist();
        await this.record("初始化规则路径");
      } catch (error) {
        this.state.targets = Object.fromEntries(
          Object.entries(this.state.targets).filter(
            ([candidatePath]) => candidatePath !== targetPath,
          ),
        );
        for (const candidate of target.candidates) {
          await this.removeCandidateFiles(candidate);
        }
        if (
          formalWritten &&
          (await this.formalContent(targetPath)) === content
        ) {
          await fs.rm(path.join(targetPath, "AGENTS.md"), { force: true });
        }
        await this.persist().catch(() => undefined);
        throw error;
      }
      await this.log("path.initialize", "ok", `path=${targetPath}`);
      return this.view();
    });
  }

  async createCandidate(selectedPath: string, name: string, content: string) {
    return this.exclusively(async () => {
      const targetPath = await this.authorizedDirectory(selectedPath);
      const target = this.requireManagedTarget(targetPath);
      this.assertNoConflict(targetPath, target);
      const candidate = await this.createSavedCandidate(target, name, content);
      try {
        await this.persist();
        await this.record("创建缓存方案规则");
      } catch (error) {
        target.candidates = target.candidates.filter(
          (item) => item.id !== candidate.id,
        );
        await this.removeCandidateFiles(candidate);
        await this.persist().catch(() => undefined);
        throw error;
      }
      await this.log(
        "candidate.create",
        "ok",
        `path=${targetPath} candidate=${candidate.id}`,
      );
      return this.view();
    });
  }

  async candidateHistory(selectedPath: string, candidateId: string) {
    const targetPath = await this.authorizedDirectory(selectedPath);
    const target = this.requireManagedTarget(targetPath);
    const candidate = this.requireCandidate(target, candidateId);
    const revisionFile = this.candidateRevisionSnapshotPath(candidate);
    const contentFile = `candidates/${candidate.file}`;
    const { stdout } = await execute(
      "git",
      ["log", "--format=%H%x1f%aI%x1f%s", "--", contentFile, revisionFile],
      { cwd: this.historyDirectory, maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line): CandidateRevision => {
        const [commit, createdAt, ...summary] = line.split("\x1f");
        return { commit, createdAt, summary: summary.join("\x1f") };
      });
  }

  async candidateRevision(
    selectedPath: string,
    candidateId: string,
    commit: string,
  ) {
    const targetPath = await this.authorizedDirectory(selectedPath);
    const target = this.requireManagedTarget(targetPath);
    const candidate = this.requireCandidate(target, candidateId);
    if (!/^[a-f\d]{40,64}$/i.test(commit)) {
      throw new Error("历史版本标识无效。");
    }
    const contentFile = `candidates/${candidate.file}`;
    const { stdout: content } = await execute(
      "git",
      ["show", `${commit}:${contentFile}`],
      { cwd: this.historyDirectory, maxBuffer: 16 * 1024 * 1024 },
    );
    let snapshot: string | undefined;
    try {
      const result = await execute(
        "git",
        ["show", `${commit}:${this.candidateRevisionSnapshotPath(candidate)}`],
        { cwd: this.historyDirectory, maxBuffer: 1024 * 1024 },
      );
      snapshot = result.stdout;
    } catch (error) {
      const stderr = (error as { stderr?: unknown }).stderr;
      if (typeof stderr !== "string" || !stderr.includes("does not exist in")) {
        throw error;
      }
    }
    const parsed = snapshot
      ? (JSON.parse(snapshot) as CandidateRevisionSnapshot)
      : null;
    const name =
      parsed && typeof parsed.name === "string" ? parsed.name : undefined;
    return { content, name };
  }

  async saveCandidate(
    selectedPath: string,
    candidateId: string,
    name: string,
    content: string,
    expectedName: string,
    expectedContent: string,
  ) {
    return this.exclusively(async () => {
      const targetPath = await this.authorizedDirectory(selectedPath);
      const target = this.requireManagedTarget(targetPath);
      this.assertNoConflict(targetPath, target);
      const candidate = this.requireCandidate(target, candidateId);
      const wasLocked = target.lockedCandidateId === candidate.id;
      if (candidate.archived)
        throw new Error("已归档缓存方案必须先恢复才能编辑。");
      const previousContent = await this.readCandidate(candidate);
      const previousName = candidate.name;
      if (
        previousName !== expectedName ||
        previousContent !== expectedContent
      ) {
        throw new CandidateChangedError();
      }
      const revisionSnapshotFile =
        this.candidateRevisionSnapshotPath(candidate);
      const previousRevisionSnapshot = await this.readFileOrNull(
        path.join(this.historyDirectory, revisionSnapshotFile),
      );
      const formalBefore = await this.formalContent(targetPath);
      if (wasLocked && formalBefore !== previousContent) {
        throw new Error(
          "磁盘文件在保存期间发生变化。已取消保存，请重新扫描并处理不一致。",
        );
      }

      try {
        await this.writeCandidate(candidate, content);
        candidate.name = name.trim() || candidate.name;
        await this.writeCandidateRevisionSnapshot(candidate);
        if (wasLocked) {
          if ((await this.formalContent(targetPath)) !== formalBefore) {
            throw new Error(
              "磁盘文件在保存期间发生变化。已取消保存，请重新扫描并处理不一致。",
            );
          }
          await this.writeFormal(targetPath, content);
        }
        await this.persist();
        await this.record("保存方案规则");
      } catch (error) {
        candidate.name = previousName;
        await this.writeCandidate(candidate, previousContent).catch(
          () => undefined,
        );
        if (previousRevisionSnapshot === null) {
          await fs
            .rm(path.join(this.historyDirectory, revisionSnapshotFile), {
              force: true,
            })
            .catch(() => undefined);
        } else {
          await this.writeAtomic(
            path.join(this.historyDirectory, revisionSnapshotFile),
            previousRevisionSnapshot,
          ).catch(() => undefined);
        }
        if (
          wasLocked &&
          formalBefore !== null &&
          (await this.formalContent(targetPath)) === content
        ) {
          await this.writeFormal(targetPath, formalBefore).catch(
            () => undefined,
          );
        }
        await this.persist().catch(() => undefined);
        throw error;
      }
      await this.log(
        "candidate.save",
        "ok",
        `path=${targetPath} candidate=${candidate.id} locked=${wasLocked}`,
      );
      return this.view();
    });
  }

  async saveDiskFile(
    selectedPath: string,
    content: string,
    expectedContent: string,
  ) {
    return this.exclusively(async () => {
      const targetPath = await this.authorizedDirectory(selectedPath);
      this.requireManagedTarget(targetPath);
      const currentContent = await this.formalContent(targetPath);
      if (currentContent === null || currentContent !== expectedContent) {
        throw new CandidateChangedError();
      }
      await this.writeFormal(targetPath, content);
      await this.record("并排对比中保存磁盘文件");
      await this.log("disk.save", "ok", `path=${targetPath}`);
      return this.view();
    });
  }

  async renameCandidate(
    selectedPath: string,
    candidateId: string,
    name: string,
    expectedName: string,
  ) {
    return this.exclusively(async () => {
      const targetPath = await this.authorizedDirectory(selectedPath);
      const target = this.requireManagedTarget(targetPath);
      this.assertNoConflict(targetPath, target);
      const candidate = this.requireCandidate(target, candidateId);
      if (candidate.name !== expectedName) throw new CandidateChangedError();
      const nextName = name.trim();
      if (!nextName) throw new Error("请输入方案名称。");
      if (nextName === candidate.name) return this.view();

      const previousName = candidate.name;
      const revisionSnapshotFile =
        this.candidateRevisionSnapshotPath(candidate);
      const previousRevisionSnapshot = await this.readFileOrNull(
        path.join(this.historyDirectory, revisionSnapshotFile),
      );
      try {
        candidate.name = nextName;
        await this.writeCandidateRevisionSnapshot(candidate);
        await this.persist();
        await this.record("重命名缓存方案");
      } catch (error) {
        candidate.name = previousName;
        if (previousRevisionSnapshot === null) {
          await fs
            .rm(path.join(this.historyDirectory, revisionSnapshotFile), {
              force: true,
            })
            .catch(() => undefined);
        } else {
          await this.writeAtomic(
            path.join(this.historyDirectory, revisionSnapshotFile),
            previousRevisionSnapshot,
          ).catch(() => undefined);
        }
        await this.persist().catch(() => undefined);
        throw error;
      }
      await this.log(
        "candidate.rename",
        "ok",
        `path=${targetPath} candidate=${candidate.id}`,
      );
      return this.view();
    });
  }

  async deleteCandidate(selectedPath: string, candidateId: string) {
    return this.exclusively(async () => {
      const targetPath = await this.authorizedDirectory(selectedPath);
      const target = this.requireManagedTarget(targetPath);
      this.assertNoConflict(targetPath, target);
      const candidate = this.requireCandidate(target, candidateId);
      if (target.lockedCandidateId === candidate.id) {
        throw new Error("当前方案不能删除。");
      }

      const content = await this.readCandidate(candidate);
      const revisionSnapshotFile =
        this.candidateRevisionSnapshotPath(candidate);
      const previousRevisionSnapshot = await this.readFileOrNull(
        path.join(this.historyDirectory, revisionSnapshotFile),
      );
      const candidateIndex = target.candidates.indexOf(candidate);
      target.candidates.splice(candidateIndex, 1);
      try {
        await this.persist();
        await this.removeCandidateFiles(candidate);
        await this.record("删除缓存方案");
      } catch (error) {
        target.candidates.splice(candidateIndex, 0, candidate);
        await this.writeCandidate(candidate, content).catch(() => undefined);
        if (previousRevisionSnapshot !== null) {
          await this.writeAtomic(
            path.join(this.historyDirectory, revisionSnapshotFile),
            previousRevisionSnapshot,
          ).catch(() => undefined);
        }
        await this.persist().catch(() => undefined);
        throw error;
      }
      await this.log(
        "candidate.delete",
        "ok",
        `path=${targetPath} candidate=${candidate.id}`,
      );
      return this.view();
    });
  }

  async lockCandidate(selectedPath: string, candidateId: string) {
    return this.exclusively(async () => {
      const targetPath = await this.authorizedDirectory(selectedPath);
      const target = this.requireManagedTarget(targetPath);
      this.assertNoConflict(targetPath, target);
      const candidate = this.requireCandidate(target, candidateId);
      if (candidate.archived)
        throw new Error("已归档缓存方案必须先恢复才能切换为当前方案。");
      const formalBefore = await this.formalContent(targetPath);
      const locked = this.requireCandidate(
        target,
        target.lockedCandidateId ?? "",
      );
      if (formalBefore !== (await this.readCandidate(locked))) {
        throw new Error(
          "磁盘文件在切换期间发生变化。已取消切换，请重新扫描并处理不一致。",
        );
      }
      const previousLockedId = target.lockedCandidateId;
      const nextContent = await this.readCandidate(candidate);
      try {
        if ((await this.formalContent(targetPath)) !== formalBefore) {
          throw new Error("磁盘文件已变化，请重新扫描并处理不一致。");
        }
        await this.writeFormal(targetPath, nextContent);
        target.lockedCandidateId = candidate.id;
        await this.persist();
        await this.record("切换当前方案");
      } catch (error) {
        target.lockedCandidateId = previousLockedId;
        if ((await this.formalContent(targetPath)) === nextContent) {
          await this.writeFormal(targetPath, formalBefore ?? "").catch(
            () => undefined,
          );
        }
        await this.persist().catch(() => undefined);
        throw error;
      }
      await this.log(
        "candidate.lock",
        "ok",
        `path=${targetPath} candidate=${candidate.id}`,
      );
      return this.view();
    });
  }

  async setCandidateArchived(
    selectedPath: string,
    candidateId: string,
    archived: boolean,
  ) {
    return this.exclusively(async () => {
      const targetPath = await this.authorizedDirectory(selectedPath);
      const target = this.requireManagedTarget(targetPath);
      this.assertNoConflict(targetPath, target);
      const candidate = this.requireCandidate(target, candidateId);
      if (target.lockedCandidateId === candidate.id) {
        throw new Error("当前方案不能归档或恢复。");
      }
      const previous = candidate.archived ?? false;
      if (previous === archived) {
        throw new Error(
          archived ? "该缓存方案已经归档。" : "该缓存方案当前未归档。",
        );
      }
      candidate.archived = archived;
      try {
        await this.persist();
        await this.record(archived ? "归档缓存方案规则" : "恢复缓存方案规则");
      } catch (error) {
        candidate.archived = previous;
        await this.persist().catch(() => undefined);
        throw error;
      }
      await this.log(
        "candidate.archive",
        "ok",
        `path=${targetPath} candidate=${candidate.id} archived=${archived}`,
      );
      return this.view();
    });
  }

  async resolveConflict(
    selectedPath: string,
    name: string,
    content: string,
    strategy: "new-candidate" | "current-revision",
  ) {
    return this.exclusively(async () => {
      const targetPath = await this.authorizedDirectory(selectedPath);
      const target = this.requireManagedTarget(targetPath);
      if (!this.isConflict(targetPath, target)) {
        throw new Error("该路径当前没有待解决的冲突。");
      }
      const formalBefore = await this.formalContent(targetPath);
      const previousLockedId = target.lockedCandidateId;
      const currentCandidate = target.candidates.find(
        (item) => item.id === previousLockedId,
      );
      if (strategy === "current-revision" && !currentCandidate) {
        throw new Error("当前缓存方案不存在，无法追加历史版本。");
      }
      const isNewCandidate = strategy === "new-candidate";
      const targetCandidate = isNewCandidate
        ? await this.createSavedCandidate(target, name, content)
        : currentCandidate!;
      const previousContent = isNewCandidate
        ? null
        : await this.readCandidate(targetCandidate);
      const revisionSnapshotFile =
        this.candidateRevisionSnapshotPath(targetCandidate);
      const previousRevisionSnapshot = isNewCandidate
        ? null
        : await this.readFileOrNull(
            path.join(this.historyDirectory, revisionSnapshotFile),
          );
      try {
        if (!isNewCandidate) {
          await this.writeCandidate(targetCandidate, content);
          await this.writeCandidateRevisionSnapshot(targetCandidate);
        }
        if ((await this.formalContent(targetPath)) !== formalBefore) {
          throw new Error("磁盘文件在合并期间发生变化，请重新载入不一致内容。");
        }
        await this.writeFormal(targetPath, content);
        target.lockedCandidateId = targetCandidate.id;
        await this.persist();
        await this.record("解决磁盘文件与缓存方案不一致");
      } catch (error) {
        if (isNewCandidate) {
          target.candidates = target.candidates.filter(
            (item) => item.id !== targetCandidate.id,
          );
        } else if (previousContent !== null) {
          await this.writeCandidate(targetCandidate, previousContent).catch(
            () => undefined,
          );
          if (previousRevisionSnapshot === null) {
            await fs
              .rm(path.join(this.historyDirectory, revisionSnapshotFile), {
                force: true,
              })
              .catch(() => undefined);
          } else {
            await this.writeAtomic(
              path.join(this.historyDirectory, revisionSnapshotFile),
              previousRevisionSnapshot,
            ).catch(() => undefined);
          }
        }
        target.lockedCandidateId = previousLockedId;
        if (isNewCandidate) await this.removeCandidateFiles(targetCandidate);
        if ((await this.formalContent(targetPath)) === content) {
          if (formalBefore === null) {
            await fs.rm(path.join(targetPath, "AGENTS.md"), { force: true });
          } else {
            await this.writeFormal(targetPath, formalBefore).catch(
              () => undefined,
            );
          }
        }
        await this.persist().catch(() => undefined);
        throw error;
      }
      await this.log(
        "conflict.resolve",
        "ok",
        `path=${targetPath} candidate=${targetCandidate.id} strategy=${strategy}`,
      );
      return this.view();
    });
  }

  async readDiagnostics() {
    try {
      return await fs.readFile(this.diagnosticsFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  }

  async log(event: string, outcome: string, detail?: string) {
    const line =
      JSON.stringify({
        timestamp: new Date().toISOString(),
        event,
        outcome,
        detail,
      }) + "\n";
    await fs.appendFile(this.diagnosticsFile, line, "utf8");
  }

  private async readState(): Promise<StoredState> {
    try {
      const parsed = JSON.parse(
        await fs.readFile(this.stateFile, "utf8"),
      ) as StoredState;
      if (
        !Array.isArray(parsed.workspaces) ||
        parsed.targets === null ||
        typeof parsed.targets !== "object" ||
        Array.isArray(parsed.targets)
      ) {
        throw new Error("本地管理数据格式无效。");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { workspaces: [], targets: {} };
      }
      throw error;
    }
  }

  private async addDefaultUserWorkspace() {
    const userFile = userRulesFile();
    const userDirectory = path.dirname(userFile);
    try {
      const canonical = await fs.realpath(userDirectory);
      if (
        !this.state.workspaces.some((item) => this.samePath(item, canonical))
      ) {
        this.state.workspaces.unshift(canonical);
        await this.persist();
        await this.record("自动添加 Codex 用户规则路径");
      } else {
        const index = this.state.workspaces.findIndex((item) =>
          this.samePath(item, canonical),
        );
        if (index > 0) {
          this.state.workspaces.unshift(
            ...this.state.workspaces.splice(index, 1),
          );
          await this.persist();
        }
      }
      await this.log(
        "startup.user_rules",
        (await this.formalContent(canonical)) === null
          ? "missing_file"
          : "found",
        canonical,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.log("startup.user_rules", "missing", userDirectory);
    }
  }

  private async scanWorkspace(workspace: string) {
    const discovered = await this.discoverAgentFiles(workspace);
    let changed = false;
    const previousTargets = structuredClone(this.state.targets);
    const importedCandidates: SavedCandidate[] = [];
    try {
      for (const file of discovered) {
        const targetPath = path.dirname(file);
        if (!this.state.targets[targetPath]) {
          const content = await fs.readFile(file, "utf8");
          const target: SavedTarget = {
            lockedCandidateId: null,
            candidates: [],
          };
          const candidate = await this.createSavedCandidate(
            target,
            "初始缓存方案",
            content,
          );
          importedCandidates.push(candidate);
          target.lockedCandidateId = candidate.id;
          this.state.targets[targetPath] = target;
          changed = true;
        }
      }
      if (changed) {
        await this.persist();
        await this.record("扫描工作空间并导入规则");
      }
    } catch (error) {
      this.state.targets = previousTargets;
      for (const candidate of importedCandidates) {
        await this.removeCandidateFiles(candidate);
      }
      await this.persist().catch(() => undefined);
      throw error;
    }
  }

  private async discoverAgentFiles(workspace: string) {
    const pending = [workspace];
    const found: string[] = [];
    while (pending.length) {
      const directory = pending.pop()!;
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) pending.push(fullPath);
        else if (entry.isFile() && entry.name === "AGENTS.md")
          found.push(await fs.realpath(fullPath));
      }
    }
    return found.sort();
  }

  private async view(): Promise<ManagerState> {
    const targets: RulePath[] = [];
    for (const [targetPath, stored] of Object.entries(this.state.targets)) {
      const candidates: Candidate[] = [];
      for (const candidate of stored.candidates) {
        candidates.push({
          id: candidate.id,
          name: candidate.name,
          content: await this.readCandidate(candidate),
          locked: stored.lockedCandidateId === candidate.id,
          archived: candidate.archived ?? false,
        });
      }
      targets.push({
        path: targetPath,
        formalContent: await this.formalContent(targetPath),
        lockedCandidateId: stored.lockedCandidateId,
        candidates,
        conflict: this.isConflict(targetPath, stored),
      });
    }
    targets.sort((left, right) => left.path.localeCompare(right.path));
    return {
      workspaces: [...this.state.workspaces],
      targets,
      historyPath: this.historyDirectory,
      diagnosticsPath: this.diagnosticsFile,
      userRulesPath: userRulesFile(),
    };
  }

  private isConflict(targetPath: string, target: SavedTarget) {
    const locked = target.candidates.find(
      (item) => item.id === target.lockedCandidateId,
    );
    if (!locked) return true;
    try {
      const formal = readFileSync(path.join(targetPath, "AGENTS.md"), "utf8");
      const candidate = readFileSync(
        path.join(this.candidateDirectory, locked.file),
        "utf8",
      );
      return formal !== candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    }
  }

  private async formalContent(targetPath: string) {
    try {
      return await fs.readFile(path.join(targetPath, "AGENTS.md"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async readFileOrNull(file: string) {
    try {
      return await fs.readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async createSavedCandidate(
    target: SavedTarget,
    name: string,
    content: string,
  ) {
    const id = randomUUID();
    const candidate = {
      id,
      name: name.trim() || "未命名缓存方案",
      file: `${id}.md`,
      archived: false,
    };
    await this.writeCandidate(candidate, content);
    try {
      await this.writeCandidateRevisionSnapshot(candidate);
      target.candidates.push(candidate);
    } catch (error) {
      await this.removeCandidateFiles(candidate);
      throw error;
    }
    return candidate;
  }

  private candidateRevisionSnapshotPath(candidate: SavedCandidate) {
    return `candidate-revisions/${candidate.file.replace(/\.md$/i, ".json")}`;
  }

  private async writeCandidateRevisionSnapshot(candidate: SavedCandidate) {
    const destination = path.join(
      this.historyDirectory,
      this.candidateRevisionSnapshotPath(candidate),
    );
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const snapshot: CandidateRevisionSnapshot = {
      revisionId: randomUUID(),
      name: candidate.name,
    };
    await this.writeAtomic(destination, JSON.stringify(snapshot, null, 2));
  }

  private async removeCandidateFiles(candidate: SavedCandidate) {
    await Promise.all([
      fs.rm(path.join(this.candidateDirectory, candidate.file), {
        force: true,
      }),
      fs.rm(
        path.join(
          this.historyDirectory,
          this.candidateRevisionSnapshotPath(candidate),
        ),
        { force: true },
      ),
    ]);
  }

  private async readCandidate(candidate: SavedCandidate) {
    return fs.readFile(
      path.join(this.candidateDirectory, candidate.file),
      "utf8",
    );
  }

  private async writeCandidate(candidate: SavedCandidate, content: string) {
    await this.writeAtomic(
      path.join(this.candidateDirectory, candidate.file),
      content,
    );
  }

  private async writeFormal(targetPath: string, content: string) {
    await this.writeAtomic(path.join(targetPath, "AGENTS.md"), content);
  }

  private async writeAtomic(destination: string, content: string) {
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, content, "utf8");
    try {
      await fs.rename(temporary, destination);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async persist() {
    const temporary = `${this.stateFile}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(this.state, null, 2), "utf8");
    await fs.rename(temporary, this.stateFile);
  }

  private async record(summary: string) {
    await fs.mkdir(this.historyDirectory, { recursive: true });
    try {
      await fs.access(path.join(this.historyDirectory, ".git"), constants.F_OK);
    } catch {
      await execute("git", ["init", "--initial-branch=main"], {
        cwd: this.historyDirectory,
      });
      await execute("git", ["config", "user.name", "PromptDock 本地历史"], {
        cwd: this.historyDirectory,
      });
      await execute("git", ["config", "user.email", "promptdock@localhost"], {
        cwd: this.historyDirectory,
      });
    }
    await execute("git", ["add", "--all"], { cwd: this.historyDirectory });
    const { stdout } = await execute("git", ["status", "--porcelain"], {
      cwd: this.historyDirectory,
    });
    if (stdout.trim()) {
      await execute("git", ["commit", "-m", summary], {
        cwd: this.historyDirectory,
      });
    } else {
      await execute("git", ["commit", "--allow-empty", "-m", summary], {
        cwd: this.historyDirectory,
      });
    }
  }

  private requireManagedTarget(targetPath: string) {
    const target = this.state.targets[targetPath];
    if (!target) throw new Error("该规则路径尚未纳入管理。");
    return target;
  }

  private requireCandidate(target: SavedTarget, id: string) {
    const candidate = target.candidates.find((item) => item.id === id);
    if (!candidate) throw new Error("指定缓存方案不存在。");
    return candidate;
  }

  private assertNoConflict(targetPath: string, target: SavedTarget) {
    if (this.isConflict(targetPath, target))
      throw new Error("磁盘文件与当前方案不一致，请先解决后再操作。");
  }

  private async authorizedDirectory(selectedPath: string) {
    const canonical = await this.existingDirectory(selectedPath);
    if (
      !this.state.workspaces.some((workspace) =>
        this.isWithin(canonical, workspace),
      )
    ) {
      throw new Error("该目录不属于已添加的工作空间。");
    }
    return canonical;
  }

  private async existingDirectory(selectedPath: string) {
    if (!selectedPath.trim()) throw new Error("请输入目录路径。");
    const canonical = await fs.realpath(path.resolve(selectedPath.trim()));
    const stat = await fs.stat(canonical);
    if (!stat.isDirectory()) throw new Error("所选路径不是文件夹。");
    return canonical;
  }

  private isWithin(candidatePath: string, rootPath: string) {
    const relative = path.relative(rootPath, candidatePath);
    const normalized =
      process.platform === "win32" ? relative.toLowerCase() : relative;
    return (
      normalized === "" ||
      (!normalized.startsWith(`..${path.sep}`) &&
        normalized !== ".." &&
        !path.isAbsolute(relative))
    );
  }

  private samePath(left: string, right: string) {
    const normalize = (value: string) =>
      path.resolve(value).replace(/[\\/]+$/, "");
    const first = normalize(left);
    const second = normalize(right);
    return process.platform === "win32"
      ? first.toLowerCase() === second.toLowerCase()
      : first === second;
  }

  private async exclusively<T>(action: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.mutationQueue;
    this.mutationQueue = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }
}
