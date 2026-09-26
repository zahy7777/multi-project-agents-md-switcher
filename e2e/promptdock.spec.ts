import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const testRootValue = process.env.PROMPTDOCK_E2E_ROOT;
if (!testRootValue) throw new Error("PROMPTDOCK_E2E_ROOT is not configured.");
const testRoot: string = testRootValue;

async function makeWorkspace(name: string, initialRules?: string) {
  const workspace = path.join(testRoot, name);
  await mkdir(workspace, { recursive: true });
  if (initialRules !== undefined) {
    await writeFile(path.join(workspace, "AGENTS.md"), initialRules, "utf8");
  }
  return workspace;
}

async function addWorkspace(
  page: import("@playwright/test").Page,
  workspace: string,
) {
  await page.getByRole("button", { name: "添加工作空间" }).first().click();
  await page.getByPlaceholder(/例如 C:/).fill(workspace);
  await page.getByRole("button", { name: "添加并扫描" }).click();
  await expect(page.getByRole("heading", { name: "添加工作空间" })).toHaveCount(
    0,
  );
  const workspaceButton = page.getByRole("button", {
    name: path.basename(workspace),
    exact: true,
  });
  await expect(workspaceButton).toBeVisible();
  await workspaceButton.click();
  await expect(
    page.getByRole("button", { name: "重新扫描当前工作空间" }),
  ).toBeEnabled();
}

test("候选编辑、预览、切换与冲突合并贯穿真实界面和本地文件", async ({
  page,
}) => {
  const originalRules =
    "# Shared\n\n| Topic | Detail |\n| --- | --- |\n| Prompt | Local |\n\ncommon line\nformal only\n";
  const candidateRules =
    "# Shared\n\n| Topic | Detail |\n| --- | --- |\n| Prompt | Local |\n\ncommon line\ncandidate only\n- [x] review locally\n![test marker](http://127.0.0.1:9999/private.png)\n";
  const externalRules =
    "# Shared\n\n| Topic | Detail |\n| --- | --- |\n| Prompt | Local |\n\ncommon line\nexternal only\n";
  const mergedRules =
    "# Merged\n\ncommon line\nexternal only\ncandidate only\n";
  const workspace = await makeWorkspace("project-rules", originalRules);
  const unexpectedImageRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("private.png")) {
      unexpectedImageRequests.push(request.url());
    }
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: /用户级规则/ })).toBeVisible();
  await addWorkspace(page, workspace);
  await expect(page.getByLabel("候选内容")).toHaveValue(originalRules);

  await page.getByRole("button", { name: "新建候选" }).click();
  await page.getByPlaceholder("例如：更严格的代码审查").fill("Candidate B");
  await expect(page.getByRole("button", { name: "创建候选" })).toBeEnabled();
  await page.getByRole("button", { name: "创建候选" }).click();
  await expect(page.getByRole("heading", { name: "创建候选" })).toHaveCount(0);
  await expect(page.getByLabel("候选名称")).toHaveValue("Candidate B");
  await expect(page.getByLabel("候选内容")).toHaveValue(originalRules);
  await page.getByLabel("候选内容").fill(candidateRules);
  const shortcutSavePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/candidates") &&
      response.request().method() === "PUT",
  );
  await page.getByLabel("候选内容").press("Control+s");
  const shortcutSaveResponse = await shortcutSavePromise;
  expect(shortcutSaveResponse.ok()).toBe(true);
  await expect(page.getByText(/所有更改已保存/)).toBeVisible();
  const shortcutSaveState = await shortcutSaveResponse.json();
  const shortcutSaveTarget = shortcutSaveState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(
    shortcutSaveTarget.candidates.find(
      (item: { name: string }) => item.name === "Candidate B",
    ).content,
  ).toBe(candidateRules);

  const importedSource = path.join(testRoot, "legacy prompt.md");
  const importedRules = "# Imported legacy prompt\n\nDo not modify source.\n";
  await writeFile(importedSource, importedRules, "utf8");
  await page.getByRole("button", { name: "从 Markdown 导入候选" }).click();
  await page.getByLabel("选择候选 Markdown 文件").setInputFiles(importedSource);
  await expect(page.getByLabel("候选名称")).toHaveValue("legacy prompt");
  await expect(page.getByLabel("候选内容")).toHaveValue(importedRules);
  expect(await readFile(importedSource, "utf8")).toBe(importedRules);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    originalRules,
  );
  const importedStateResponse = await page.request.get("/api/state");
  const importedState = await importedStateResponse.json();
  const importedTarget = importedState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(
    importedTarget.candidates.find(
      (item: { name: string }) => item.name === "legacy prompt",
    ).locked,
  ).toBe(false);
  await page.getByRole("button", { name: "Candidate B 候选" }).click();

  const unsavedDraft = `${candidateRules}do not discard without confirmation\n`;
  await page.getByLabel("候选内容").fill(unsavedDraft);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "legacy prompt 候选" }).click();
  await expect(page.getByLabel("候选内容")).toHaveValue(unsavedDraft);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "legacy prompt 候选" }).click();
  await expect(page.getByLabel("候选内容")).toHaveValue(importedRules);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    originalRules,
  );
  await page.getByRole("button", { name: "Candidate B 候选" }).click();
  await expect(page.getByLabel("候选内容")).toHaveValue(candidateRules);

  const comparisonDraft = `${candidateRules}comparison draft only\n`;
  await page.getByLabel("候选内容").fill(comparisonDraft);
  await page.getByRole("button", { name: "与其他版本对比" }).click();
  await page
    .getByLabel("对比基准版本")
    .selectOption({ label: "legacy prompt" });
  await expect(page.locator(".compare-column header strong").nth(1)).toHaveText(
    "legacy prompt",
  );
  await expect(page.locator(".compare-column pre").nth(1)).toHaveText(
    importedRules,
  );
  await expect(page.locator(".compare-column pre").nth(0)).toHaveText(
    comparisonDraft,
  );
  await expect(
    page.getByText("左侧显示当前编辑器内容（含未保存修改）", { exact: false }),
  ).toBeVisible();
  const comparisonStateResponse = await page.request.get("/api/state");
  const comparisonState = await comparisonStateResponse.json();
  const comparisonTarget = comparisonState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(
    comparisonTarget.candidates.find(
      (item: { name: string }) => item.name === "Candidate B",
    ).content,
  ).toBe(candidateRules);
  await page.getByRole("button", { name: "标记差异" }).click();
  await expect(
    page
      .locator(".candidate-compare-diff .added code")
      .getByText("candidate only", {
        exact: true,
      }),
  ).toBeVisible();
  await expect(
    page
      .locator(".candidate-compare-diff .added code")
      .getByText("comparison draft only", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".candidate-compare-diff .removed code")
      .getByText("Do not modify source.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "并排原文" }).click();
  await expect(page.locator(".compare-column")).toHaveCount(2);
  await page.getByRole("button", { name: "返回候选" }).click();
  await page.getByLabel("候选内容").fill(candidateRules);
  await expect(page.getByText(/所有更改已保存/)).toBeVisible();

  await page.getByLabel("候选内容").fill("");
  await page.getByRole("button", { name: "与其他版本对比" }).click();
  await page
    .getByLabel("对比基准版本")
    .selectOption({ label: "legacy prompt" });
  await expect(page.locator(".compare-column pre").nth(0)).toHaveText("");
  await page.getByRole("button", { name: "标记差异" }).click();
  await expect(
    page
      .locator(".candidate-compare-diff .removed code")
      .getByText("Do not modify source.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".candidate-compare-diff .added code")).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "返回候选" }).click();
  await page.getByLabel("候选内容").fill(candidateRules);
  await expect(page.getByText(/所有更改已保存/)).toBeVisible();

  const exportedDraft = `${candidateRules}export-only draft\n`;
  await page.getByLabel("候选名称").fill("Candidate/B*");
  await page.getByLabel("候选内容").fill(exportedDraft);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Markdown" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Candidate_B_.md");
  const exportedFile = path.join(testRoot, "exported candidate.md");
  await download.saveAs(exportedFile);
  expect(await readFile(exportedFile, "utf8")).toBe(exportedDraft);
  await expect(page.getByText(/有未保存更改/)).toBeVisible();
  const exportStateResponse = await page.request.get("/api/state");
  const exportState = await exportStateResponse.json();
  const exportTarget = exportState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  const savedCandidate = exportTarget.candidates.find(
    (item: { name: string }) => item.name === "Candidate B",
  );
  expect(savedCandidate.content).toBe(candidateRules);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    originalRules,
  );
  await page.getByLabel("候选名称").fill("Candidate B");
  await page.getByLabel("候选内容").fill(candidateRules);
  await expect(page.getByText(/所有更改已保存/)).toBeVisible();

  await page.getByRole("button", { name: "预览" }).click();
  await expect(page.locator(".markdown-preview h1")).toHaveText("Shared");
  await expect(page.locator(".markdown-preview table")).toHaveCount(1);
  await expect(
    page.locator(".markdown-preview input[type=checkbox]"),
  ).toHaveCount(1);
  await expect(page.locator(".markdown-preview img")).toHaveCount(0);
  await expect(page.locator(".markdown-image-placeholder")).toContainText(
    "test marker",
  );
  expect(unexpectedImageRequests).toEqual([]);
  await page.getByRole("button", { name: "编辑" }).click();

  await page.getByRole("button", { name: "与其他版本对比" }).click();
  await page.getByRole("button", { name: "并排原文" }).click();
  await expect(page.locator(".compare-column header strong").nth(1)).toHaveText(
    "导入的正式规则",
  );
  await expect(page.locator(".compare-column pre").nth(0)).toHaveText(
    candidateRules,
  );
  await expect(page.locator(".compare-column pre").nth(1)).toHaveText(
    originalRules,
  );
  await page.getByRole("button", { name: "返回候选" }).click();

  const lockCandidatePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/candidates/lock") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "切换为正式规则" }).click();
  const lockCandidateResponse = await lockCandidatePromise;
  expect(lockCandidateResponse.ok()).toBe(true);
  const lockedState = await lockCandidateResponse.json();
  const lockedTarget = lockedState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(
    lockedTarget.candidates.find(
      (item: { name: string }) => item.name === "Candidate B",
    ).locked,
  ).toBe(true);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    candidateRules,
  );
  await expect(
    page.getByRole("button", { name: "切换为正式规则" }),
  ).toHaveCount(0);
  const lockedRules = `${candidateRules}locked candidate edit\n`;
  await page.getByLabel("候选内容").fill(lockedRules);
  await expect(
    page.getByRole("button", { name: "保存并同步正式文件" }),
  ).toBeEnabled();
  const lockedSavePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/candidates") &&
      response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "保存并同步正式文件" }).click();
  const lockedSaveResponse = await lockedSavePromise;
  expect(lockedSaveResponse.ok()).toBe(true);
  await expect(page.getByText(/所有更改已保存/)).toBeVisible();
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    lockedRules,
  );
  await writeFile(path.join(workspace, "AGENTS.md"), externalRules, "utf8");
  await page.getByRole("button", { name: "重新扫描当前工作空间" }).click();
  await expect(
    page.getByRole("heading", { name: "规则文件冲突" }),
  ).toBeVisible();
  await expect(page.getByText("external only", { exact: true })).toBeVisible();
  await expect(page.getByText("candidate only", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "并排原文" }).click();
  await expect(page.locator(".compare-panel")).toHaveCount(2);
  await page.getByRole("button", { name: "标记差异" }).click();
  await page.getByRole("button", { name: "把正式文件放入解决稿" }).click();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(externalRules);
  await page.getByRole("button", { name: "把锁定候选放入解决稿" }).click();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(lockedRules);
  await page.getByLabel("冲突候选名称").fill("Merged rules");
  await page.getByLabel("冲突解决内容").fill(mergedRules);
  await page.getByRole("button", { name: "保存解决结果" }).click();
  await expect(page.getByText("与锁定候选一致", { exact: true })).toBeVisible();

  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    mergedRules,
  );
  const stateResponse = await page.request.get("/api/state");
  const state = await stateResponse.json();
  const target = state.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(target.conflict).toBe(false);
  expect(
    target.candidates.find((item: { locked: boolean }) => item.locked).content,
  ).toBe(mergedRules);

  await page.getByRole("button", { name: "Candidate B 候选" }).click();
  const historyComparisonDraft = `${lockedRules}unsaved history draft\n`;
  await page.getByLabel("候选内容").fill(historyComparisonDraft);
  await page.getByRole("button", { name: "查看候选历史" }).click();
  await expect(page.locator(".history-revision")).toHaveCount(3);
  await page.locator(".history-revision").last().click();
  await expect(
    page
      .locator(".history-version-view .removed code")
      .getByText("formal only", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".history-version-view .added code")
      .getByText("locked candidate edit", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".history-version-view .added code")
      .getByText("unsaved history draft", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "历史全文" }).click();
  await expect(page.locator(".history-preview")).toHaveText(originalRules);
  await page.getByRole("button", { name: "标记差异" }).click();
  const historyViewStateResponse = await page.request.get("/api/state");
  const historyViewState = await historyViewStateResponse.json();
  const historyViewTarget = historyViewState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  const historyViewCandidateIds = historyViewTarget.candidates
    .map((item: { id: string }) => item.id)
    .sort();
  expect(
    historyViewTarget.candidates.find(
      (item: { name: string }) => item.name === "Candidate B",
    ).content,
  ).toBe(lockedRules);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    mergedRules,
  );
  if (process.env.PROMPTDOCK_SCREENSHOT_PATH) {
    await page.screenshot({ path: process.env.PROMPTDOCK_SCREENSHOT_PATH });
  }
  const cancelledRestoreConfirmation = page.waitForEvent("dialog");
  const cancelledRestoreClick = page
    .getByRole("button", { name: "从此版本创建候选" })
    .click();
  const cancelledRestoreDialog = await cancelledRestoreConfirmation;
  expect(cancelledRestoreDialog.message()).toContain("有未保存修改");
  await cancelledRestoreDialog.dismiss();
  await cancelledRestoreClick;
  await expect(
    page.getByRole("heading", { name: "Candidate B 的已保存版本" }),
  ).toBeVisible();
  await expect(page.getByLabel("候选内容")).toHaveValue(historyComparisonDraft);
  const cancelledRestoreStateResponse = await page.request.get("/api/state");
  const cancelledRestoreState = await cancelledRestoreStateResponse.json();
  const cancelledRestoreTarget = cancelledRestoreState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(
    cancelledRestoreTarget.candidates
      .map((item: { id: string }) => item.id)
      .sort(),
  ).toEqual(historyViewCandidateIds);
  expect(
    cancelledRestoreTarget.candidates.some(
      (item: { name: string }) => item.name === "Candidate B（历史恢复）",
    ),
  ).toBe(false);

  const restoreConfirmation = page.waitForEvent("dialog");
  const restoreClick = page
    .getByRole("button", { name: "从此版本创建候选" })
    .click();
  const restoreDialog = await restoreConfirmation;
  expect(restoreDialog.message()).toContain("有未保存修改");
  await restoreDialog.accept();
  await restoreClick;
  await expect(page.getByLabel("候选名称")).toHaveValue(
    "Candidate B（历史恢复）",
  );
  await expect(page.getByLabel("候选内容")).toHaveValue(originalRules);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    mergedRules,
  );
  const restoredStateResponse = await page.request.get("/api/state");
  const restoredState = await restoredStateResponse.json();
  const restoredTarget = restoredState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(
    restoredTarget.candidates.find(
      (item: { name: string }) => item.name === "Candidate B（历史恢复）",
    ).locked,
  ).toBe(false);
  expect(
    restoredTarget.candidates.find((item: { locked: boolean }) => item.locked)
      .content,
  ).toBe(mergedRules);
  expect(
    restoredTarget.candidates.find(
      (item: { name: string }) => item.name === "Candidate B",
    ).content,
  ).toBe(lockedRules);
  const candidateSearch = page.getByLabel("筛选候选");
  await candidateSearch.fill("Merged");
  await expect(page.locator(".candidate-row")).toHaveCount(1);
  await candidateSearch.fill("review locally");
  await expect(page.locator(".candidate-row")).toHaveCount(1);
  await candidateSearch.fill("does not exist");
  await expect(page.locator(".candidate-row")).toHaveCount(0);
});

test("空目录初始化后，移除工作空间保留文件并可重新添加", async ({ page }) => {
  const workspace = await makeWorkspace("empty-project");
  await page.goto("/");
  await addWorkspace(page, workspace);
  await expect(page.getByText("没有发现 AGENTS.md")).toBeVisible();
  await page.getByRole("button", { name: "初始化 AGENTS.md" }).click();
  await expect(page.getByLabel("候选内容")).toHaveValue("# AGENTS.md\n");
  const formalFile = path.join(workspace, "AGENTS.md");
  expect(await readFile(formalFile, "utf8")).toBe("# AGENTS.md\n");

  const nestedDirectory = path.join(workspace, "nested");
  await mkdir(nestedDirectory);
  await page.getByRole("button", { name: "初始化目录" }).click();
  await expect(page.getByRole("heading", { name: "初始化目录" })).toBeVisible();
  await page.getByLabel("目录路径").fill(nestedDirectory);
  await page.getByRole("button", { name: "初始化并锁定" }).click();
  await expect(page.getByRole("heading", { name: "初始化目录" })).toHaveCount(
    0,
  );
  const nestedFormalFile = path.join(nestedDirectory, "AGENTS.md");
  expect(await readFile(nestedFormalFile, "utf8")).toBe("# AGENTS.md\n");

  await expect(
    page.getByRole("button", { name: "从列表移除工作空间 codex" }),
  ).toHaveCount(0);
  const beforeResponse = await page.request.get("/api/state");
  const beforeState = await beforeResponse.json();
  const beforeTarget = beforeState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  const candidateId = beforeTarget.candidates[0].id;

  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "从列表移除工作空间 empty-project" })
    .click();
  await expect(
    page.getByRole("button", { name: "empty-project", exact: true }),
  ).toHaveCount(0);
  expect(await readFile(formalFile, "utf8")).toBe("# AGENTS.md\n");
  expect(await readFile(nestedFormalFile, "utf8")).toBe("# AGENTS.md\n");

  await addWorkspace(page, workspace);
  await expect(page.getByLabel("候选内容")).toHaveValue("# AGENTS.md\n");
  const afterResponse = await page.request.get("/api/state");
  const afterState = await afterResponse.json();
  const afterTarget = afterState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(
    afterTarget.candidates.map((item: { id: string }) => item.id),
  ).toContain(candidateId);
  const nestedTarget = afterState.targets.find(
    (item: { path: string }) => item.path === nestedDirectory,
  );
  expect(nestedTarget).toBeDefined();
  expect(await readFile(nestedFormalFile, "utf8")).toBe("# AGENTS.md\n");
});

test("帮助诊断链接可打开本机日志，错误添加可重试", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "使用说明与诊断" }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("link", { name: "在浏览器中打开诊断日志" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/api\/diagnostics$/);
  await expect(popup.locator("body")).toContainText('"event"');
  await popup.close();
  await page.getByRole("button", { name: "知道了" }).click();

  await page.getByRole("button", { name: "添加工作空间" }).first().click();
  await page
    .getByPlaceholder(/例如 C:/)
    .fill(path.join(testRoot, "missing-workspace"));
  await page.getByRole("button", { name: "添加并扫描" }).click();
  await expect(page.locator(".toast-error")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "添加工作空间" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
});
