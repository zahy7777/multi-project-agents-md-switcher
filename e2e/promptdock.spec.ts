import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

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
  await page.getByPlaceholder("选择文件夹，或输入本机路径").fill(workspace);
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
  await expectVisibleButtonsHaveNames(page);
}

async function expectVisibleButtonsHaveNames(
  page: import("@playwright/test").Page,
) {
  for (const button of await page.getByRole("button").all()) {
    if (await button.isVisible()) {
      await expect(button).toHaveAccessibleName(/\S+/);
    }
  }
}

test("跨路径规则搜索能跳转缓存方案并保护未保存草稿", async ({ page }) => {
  const workspace = await makeWorkspace(
    "global-rule-search",
    "root-only search phrase\n",
  );
  const nestedDirectory = path.join(workspace, "nested", "rules");
  const nestedRules = "nested-only search phrase\nsecond line\n";
  await mkdir(nestedDirectory, { recursive: true });
  await writeFile(path.join(nestedDirectory, "AGENTS.md"), nestedRules, "utf8");

  await page.goto("/");
  await addWorkspace(page, workspace);
  await page
    .getByRole("button", { name: path.join("nested", "rules") })
    .click();
  await page.getByRole("button", { name: "新建缓存方案" }).click();
  await page
    .getByRole("textbox", { name: "新方案名称" })
    .fill("Archived search test");
  await page.getByRole("button", { name: "创建缓存方案" }).click();
  await expect(page.getByRole("heading", { name: "创建缓存方案" })).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "方案内容", exact: true })
    .fill("archived-only search phrase\n");
  await page.getByRole("button", { name: "保存方案" }).click();
  await expect(page.getByText(/历史版本已保存/)).toBeVisible();
  await page.getByRole("button", { name: "归档当前方案" }).click();
  await expect(
    page.getByText("已归档「Archived search test」，正文和版本历史仍保留"),
  ).toBeVisible();
  await page.getByRole("button", { name: "AGENTS.md", exact: true }).click();

  await page.getByRole("button", { name: "搜索全部规则正文" }).click();
  await page
    .getByRole("textbox", { name: "搜索规则正文" })
    .fill("archived-only search phrase");
  const archivedResult = page.locator(".rule-search-result");
  await expect(archivedResult).toHaveCount(1);
  await expect(archivedResult.first()).toContainText(
    "Archived search test · 已归档",
  );
  if (process.env.PROMPTDOCK_SCREENSHOT_PATH) {
    await page.screenshot({ path: process.env.PROMPTDOCK_SCREENSHOT_PATH });
  }
  await archivedResult.first().click();
  await expect(
    page.getByRole("textbox", { name: "方案内容", exact: true }),
  ).toHaveValue("archived-only search phrase\n");
  await expect(
    page.getByRole("textbox", { name: "方案内容", exact: true }),
  ).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "搜索全部规则正文" }).click();
  await page
    .getByRole("textbox", { name: "搜索规则正文" })
    .fill("nested-only search phrase");

  const nestedResult = page.locator(".rule-search-result");
  await expect(nestedResult).toHaveCount(1);
  await expect(nestedResult.first()).toContainText("nested-only search phrase");
  await nestedResult.first().click();
  await expect(page.getByLabel("方案内容")).toHaveValue(nestedRules);

  const unsavedDraft = `${nestedRules}unsaved search navigation draft\n`;
  await page.getByLabel("方案内容").fill(unsavedDraft);
  await page.getByRole("button", { name: "搜索全部规则正文" }).click();
  await page
    .getByRole("textbox", { name: "搜索规则正文" })
    .fill("root-only search phrase");
  const rootResult = page.locator(".rule-search-result").first();

  const cancelledNavigation = page.waitForEvent("dialog");
  const cancelledResultClick = rootResult.click();
  const cancelDialog = await cancelledNavigation;
  expect(cancelDialog.message()).toContain("方案内容有未保存修改");
  await cancelDialog.dismiss();
  await cancelledResultClick;
  await expect(page.getByLabel("方案内容")).toHaveValue(unsavedDraft);
  await expect(
    page.getByRole("dialog", { name: "搜索全部规则正文" }),
  ).toBeVisible();

  const confirmedNavigation = page.waitForEvent("dialog");
  const confirmedResultClick = rootResult.click();
  const confirmDialog = await confirmedNavigation;
  await confirmDialog.accept();
  await confirmedResultClick;
  await expect(page.getByLabel("方案内容")).toHaveValue(
    "root-only search phrase\n",
  );
  await expect(
    page.getByRole("dialog", { name: "搜索全部规则正文" }),
  ).toHaveCount(0);
  const externalRules = "external-only conflict phrase\n";
  await writeFile(
    path.join(nestedDirectory, "AGENTS.md"),
    externalRules,
    "utf8",
  );
  await page.getByRole("button", { name: "重新扫描当前工作空间" }).click();
  await expect(page.getByText("扫描完成，已导入新发现的规则")).toBeVisible();
  await page
    .getByRole("button", { name: path.join("nested", "rules") })
    .click();
  await expect(
    page.getByRole("heading", { name: "规则文件冲突" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "搜索全部规则正文" }).click();
  await page
    .getByRole("textbox", { name: "搜索规则正文" })
    .fill("external-only conflict phrase");
  await expect(page.locator(".rule-search-result")).toHaveCount(1);
  await expect(page.locator(".rule-search-result").first()).toContainText(
    "磁盘文件 · 不一致",
  );
  await page
    .getByRole("textbox", { name: "搜索规则正文" })
    .fill("nested-only search phrase");
  await expect(page.locator(".rule-search-result")).toHaveCount(1);
  await expect(page.locator(".rule-search-result").first()).toContainText(
    "缓存方案 · 导入的正式规则 · 当前生效",
  );
  await page.getByRole("button", { name: "关闭规则搜索" }).click();
  const unsavedResolution = `${externalRules}unsaved conflict search draft\n`;
  await page.getByLabel("冲突解决内容").fill(unsavedResolution);
  await page.getByRole("button", { name: "搜索全部规则正文" }).click();
  await page
    .getByRole("textbox", { name: "搜索规则正文" })
    .fill("root-only search phrase");
  const rootSearchResult = page.locator(".rule-search-result").first();
  const cancelledConflictNavigation = page.waitForEvent("dialog");
  const cancelledConflictClick = rootSearchResult.click();
  const conflictDialog = await cancelledConflictNavigation;
  expect(conflictDialog.message()).toContain("冲突解决稿有未保存修改");
  await conflictDialog.dismiss();
  await cancelledConflictClick;
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(unsavedResolution);
});

test("工作空间 Ignore 按 gitignore 语义过滤磁盘文件并保留可恢复状态", async ({ page }, testInfo) => {
  const workspace = await makeWorkspace("workspace-ignore", "root rules\n");
  const ignoredDirectory = path.join(workspace, "archive", "draft-one");
  const visibleDirectory = path.join(workspace, "current");
  await mkdir(ignoredDirectory, { recursive: true });
  await mkdir(visibleDirectory, { recursive: true });
  await writeFile(path.join(ignoredDirectory, "AGENTS.md"), "archived rules\n", "utf8");
  await writeFile(path.join(visibleDirectory, "AGENTS.md"), "current rules\n", "utf8");

  await page.goto("/");
  await addWorkspace(page, workspace);
  await page.getByRole("button", { name: "Ignore 规则" }).click();
  await expect(page.getByLabel("Ignore 规则内容")).toBeVisible();
  await page.getByLabel("Ignore 规则内容").fill("archive/\n");
  await page.getByRole("button", { name: "保存并重新扫描" }).click();
  await expect(page.getByRole("button", { name: /archive[\\/]draft-one/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "current", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "AGENTS.md", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("ignore-panel.png") });
  await page.getByRole("button", { name: "搜索全部文件" }).click();
  await page.getByLabel("搜索文件正文").fill("archived rules");
  await expect(page.getByText("没有匹配的文件正文。")).toBeVisible();
  await page.getByRole("button", { name: "关闭文件搜索" }).click();

  await page.getByLabel("Ignore 规则内容").fill("");
  await page.getByRole("button", { name: "保存并重新扫描" }).click();
  await expect(page.getByRole("button", { name: /archive[\\/]draft-one/ })).toBeVisible();
  const state = await (await page.request.get("/api/state")).json();
  expect(state.workspaceIgnoreRules[workspace]).toBe("");
});

test("Codex 用户级工作空间可独立忽略并恢复磁盘文件", async ({ page }) => {
  await page.goto("/");
  const initialState = await (await page.request.get("/api/state")).json();
  const userWorkspace = path.dirname(initialState.userRulesPath);
  await expect(page.getByRole("button", { name: "AGENTS.md", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Ignore 规则" }).click();
  await page.getByLabel("Ignore 规则内容").fill("AGENTS.md\n");
  await page.getByRole("button", { name: "保存并重新扫描" }).click();
  await expect(page.getByRole("button", { name: "AGENTS.md", exact: true })).toHaveCount(0);
  let state = await (await page.request.get("/api/state")).json();
  expect(state.workspaceIgnoreRules[userWorkspace]).toBe("AGENTS.md\n");

  await page.getByLabel("Ignore 规则内容").fill("");
  await page.getByRole("button", { name: "保存并重新扫描" }).click();
  await expect(page.getByRole("button", { name: "AGENTS.md", exact: true })).toBeVisible();
  state = await (await page.request.get("/api/state")).json();
  expect(state.workspaceIgnoreRules[userWorkspace]).toBe("");
});

test("移除工作空间后搜索不再显示保留的历史目标", async ({ page }) => {
  const workspace = await makeWorkspace(
    "removed-search-workspace",
    "retained but unregistered phrase\n",
  );
  await page.goto("/");
  await addWorkspace(page, workspace);

  const removeConfirmation = page.waitForEvent("dialog");
  const removeClick = page
    .getByRole("button", {
      name: `从列表移除工作空间 ${path.basename(workspace)}`,
    })
    .click();
  const dialog = await removeConfirmation;
  await dialog.accept();
  await removeClick;
  await expect(
    page.getByRole("button", { name: path.basename(workspace), exact: true }),
  ).toHaveCount(0);

  const state = await (await page.request.get("/api/state")).json();
  expect(
    state.targets.some((item: { path: string }) => item.path === workspace),
  ).toBe(true);

  await page.getByRole("button", { name: "搜索全部规则正文" }).click();
  await page
    .getByRole("textbox", { name: "搜索规则正文" })
    .fill("retained but unregistered phrase");
  await expect(page.getByText("没有匹配的规则正文。")).toBeVisible();
});

test("跨工作空间搜索结果会切换到规则所属工作空间", async ({ page }) => {
  const firstWorkspace = await makeWorkspace(
    "search-workspace-first",
    "phrase owned by first workspace\n",
  );
  const secondWorkspace = await makeWorkspace(
    "search-workspace-second",
    "phrase owned by second workspace\n",
  );
  await page.goto("/");
  await addWorkspace(page, firstWorkspace);
  await addWorkspace(page, secondWorkspace);

  await page.keyboard.press("Control+Shift+F");
  await expect(
    page.getByRole("dialog", { name: "搜索全部规则正文" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "搜索全部规则正文" }),
  ).toHaveCount(0);
  await page.keyboard.press("Control+Shift+F");
  await page
    .getByRole("textbox", { name: "搜索规则正文" })
    .fill("phrase owned by first workspace");
  const firstWorkspaceResult = page.locator(".rule-search-result");
  await expect(firstWorkspaceResult).toHaveCount(1);
  await expect(firstWorkspaceResult.first()).toContainText(
    path.basename(firstWorkspace),
  );
  await expect(firstWorkspaceResult.locator("mark")).toHaveText(
    "phrase owned by first workspace",
  );
  await firstWorkspaceResult.first().click();

  await expect(page.locator(".breadcrumbs")).toContainText(
    path.basename(firstWorkspace),
  );
  await expect(page.getByLabel("方案内容")).toHaveValue(
    "phrase owned by first workspace\n",
  );
});

test("缓存方案编辑、预览、切换与冲突合并贯穿真实界面和本地文件", async ({
  page,
}) => {
  const originalRules =
    "# Shared\n\n| Topic | Detail |\n| --- | --- |\n| Prompt | Local |\n\ncommon line\nformal only\n";
  const candidateRules =
    "# Shared\n\n| Topic | Detail |\n| --- | --- |\n| Prompt | Local |\n\ncommon line\ncandidate only\n- [x] review locally\n![test marker](http://127.0.0.1:9999/private.png)\n";
  const externalRules =
    "# Shared\n\n| Topic | Detail |\n| --- | --- |\n| Prompt | Local |\n\ncommon line\nexternal only\n";
  const refreshedExternalRules = `${externalRules}external second edit\n`;
  const conflictDraft = `${candidateRules}locked candidate edit\nunsaved merge idea\n`;
  const mergedRules =
    "# Merged\n\ncommon line\nexternal only\nexternal second edit\ncandidate only\nunsaved merge idea\n";
  const navigationConflictRules = `${mergedRules}navigation conflict\n`;
  const workspace = await makeWorkspace("project-rules", originalRules);
  const unexpectedImageRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("private.png")) {
      unexpectedImageRequests.push(request.url());
    }
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: /用户级规则/ })).toBeVisible();
  await page.getByRole("button", { name: "添加工作空间" }).first().click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "添加工作空间" })).toHaveCount(
    0,
  );
  const stateAfterWorkspaceEscape = await page.request.get("/api/state");
  expect((await stateAfterWorkspaceEscape.json()).workspaces).not.toContain(
    workspace,
  );
  await page.getByRole("button", { name: "添加工作空间" }).first().click();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("heading", { name: "添加工作空间" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "添加工作空间" }).first().click();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("heading", { name: "添加工作空间" })).toHaveCount(
    0,
  );
  await addWorkspace(page, workspace);
  await expect(page.getByLabel("方案内容")).toHaveValue(originalRules);

  await page.getByRole("button", { name: "新建缓存方案" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "创建缓存方案" })).toHaveCount(0);
  await expect(page.getByLabel("方案内容")).toHaveValue(originalRules);
  const candidatesAfterEscapeResponse = await page.request.get("/api/state");
  const candidatesAfterEscape = await candidatesAfterEscapeResponse.json();
  const targetAfterEscape = candidatesAfterEscape.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(targetAfterEscape.candidates).toHaveLength(1);
  await page.getByRole("button", { name: "新建缓存方案" }).click();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("heading", { name: "创建缓存方案" })).toHaveCount(0);
  await expect(page.getByLabel("方案内容")).toHaveValue(originalRules);
  await page.getByRole("button", { name: "新建缓存方案" }).click();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("heading", { name: "创建缓存方案" })).toHaveCount(0);
  await page.getByRole("button", { name: "新建缓存方案" }).click();
  await page.getByPlaceholder("例如：更严格的代码审查").fill("Candidate B");
  await expect(page.getByRole("button", { name: "创建缓存方案" })).toBeEnabled();
  await page.getByRole("button", { name: "创建缓存方案" }).click();
  await expect(page.getByRole("heading", { name: "创建缓存方案" })).toHaveCount(0);
  await expect(page.getByLabel("方案名称")).toHaveValue("Candidate B");
  await expect(page.getByLabel("方案内容")).toHaveValue(originalRules);
  await page.getByRole("button", { name: "关闭提示" }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByLabel("方案内容").fill("");
  await expect(page.getByTestId("candidate-content-stats")).toHaveText(
    "有未保存更改 · 1 行 · 0 字符 · 0 UTF-8 字节",
  );
  await page.getByLabel("方案内容").fill("first\n中文🌍\n");
  await expect(page.getByTestId("candidate-content-stats")).toHaveText(
    "有未保存更改 · 3 行 · 10 字符 · 17 UTF-8 字节",
  );
  await expect(page.getByTestId("candidate-content-stats")).toHaveAttribute(
    "title",
    /结尾换行会保留空行/,
  );
  if (process.env.PROMPTDOCK_CONTENT_STATS_SCREENSHOT_PATH) {
    await page.screenshot({
      path: process.env.PROMPTDOCK_CONTENT_STATS_SCREENSHOT_PATH,
    });
  }
  await page.setViewportSize({ width: 800, height: 720 });
  const footerGeometry = await page.evaluate(() => {
    const stats = document.querySelector(
      '[data-testid="candidate-content-stats"]',
    );
    const actions = document.querySelector(".editor-footer .heading-actions");
    if (!(stats instanceof HTMLElement) || !(actions instanceof HTMLElement)) {
      throw new Error("编辑器统计或操作区不可见");
    }
    const statsBounds = stats.getBoundingClientRect();
    const actionsBounds = actions.getBoundingClientRect();
    return { statsBottom: statsBounds.bottom, actionsTop: actionsBounds.top };
  });
  expect(footerGeometry.statsBottom).toBeLessThanOrEqual(
    footerGeometry.actionsTop,
  );
  if (process.env.PROMPTDOCK_CONTENT_STATS_NARROW_SCREENSHOT_PATH) {
    await page.screenshot({
      path: process.env.PROMPTDOCK_CONTENT_STATS_NARROW_SCREENSHOT_PATH,
    });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByLabel("方案内容").fill(originalRules);
  await page
    .getByRole("textbox", { name: "方案内容", exact: true })
    .fill(candidateRules);
  const shortcutSavePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/candidates") &&
      response.request().method() === "PUT",
  );
  await page.getByLabel("方案内容").press("Control+s");
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

  const candidateB = shortcutSaveTarget.candidates.find(
    (item: { name: string }) => item.name === "Candidate B",
  );
  const candidateHistoryUrl = `/api/candidates/${encodeURIComponent(candidateB.id)}/history?${new URLSearchParams({ path: workspace })}`;
  const historyBeforeDiscardResponse =
    await page.request.get(candidateHistoryUrl);
  const historyBeforeDiscard = await historyBeforeDiscardResponse.json();
  const formalBeforeDiscard = await readFile(
    path.join(workspace, "AGENTS.md"),
    "utf8",
  );
  await page.getByLabel("方案名称").fill("Unsaved name");
  const discardDraft = `${candidateRules}unsaved discard draft\n`;
  await page.getByLabel("方案内容").fill(discardDraft);
  const cancelledDiscard = page.waitForEvent("dialog");
  const cancelledDiscardClick = page
    .getByRole("button", { name: "还原已保存内容" })
    .click();
  const cancelledDiscardDialog = await cancelledDiscard;
  expect(cancelledDiscardDialog.message()).toContain("放弃当前未保存修改");
  await cancelledDiscardDialog.dismiss();
  await cancelledDiscardClick;
  await expect(page.getByLabel("方案名称")).toHaveValue("Unsaved name");
  await expect(page.getByLabel("方案内容")).toHaveValue(discardDraft);

  const acceptedDiscard = page.waitForEvent("dialog");
  const acceptedDiscardClick = page
    .getByRole("button", { name: "还原已保存内容" })
    .click();
  const acceptedDiscardDialog = await acceptedDiscard;
  await acceptedDiscardDialog.accept();
  await acceptedDiscardClick;
  await expect(page.getByLabel("方案名称")).toHaveValue("Candidate B");
  await expect(page.getByLabel("方案内容")).toHaveValue(candidateRules);
  await expect(
    page.getByRole("button", { name: "还原已保存内容" }),
  ).toHaveCount(0);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    formalBeforeDiscard,
  );
  const historyAfterDiscardResponse =
    await page.request.get(candidateHistoryUrl);
  expect(await historyAfterDiscardResponse.json()).toEqual(
    historyBeforeDiscard,
  );

  const branchDraft = `${candidateRules}keep this unsaved draft while branching\n`;
  await page.getByLabel("方案内容").fill(branchDraft);
  await page.getByRole("button", { name: "新建缓存方案" }).click();
  await expect(page.getByLabel("方案内容来源")).toHaveValue("");
  await page.getByLabel("方案内容来源").selectOption({ index: 1 });
  await expect(
    page.getByText(
      "将从所选缓存方案 Fork；当前编辑器中的未保存草稿会保留。",
    ),
  ).toBeVisible();
  await page.getByText("预览已保存来源正文（只读）").click();
  await expect(page.locator(".candidate-source-preview pre")).toContainText(
    "# Shared",
  );
  await expect(page.locator(".candidate-source-preview pre")).toContainText(
    "formal only",
  );
  if (process.env.PROMPTDOCK_BRANCH_MODAL_SCREENSHOT_PATH) {
    await page.screenshot({
      path: process.env.PROMPTDOCK_BRANCH_MODAL_SCREENSHOT_PATH,
    });
  }
  await page.getByLabel("新方案名称").fill("Branch from formal");
  await page.getByRole("button", { name: "创建缓存方案" }).click();
  await expect(page.getByRole("heading", { name: "创建缓存方案" })).toHaveCount(0);
  await expect(page.getByLabel("方案名称")).toHaveValue("Candidate B");
  await expect(page.getByLabel("方案内容")).toHaveValue(branchDraft);
  await expect(page.getByText(/当前未保存草稿仍保留在编辑器/)).toBeVisible();
  const branchStateResponse = await page.request.get("/api/state");
  const branchState = await branchStateResponse.json();
  const branchTarget = branchState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  const branchedCandidate = branchTarget.candidates.find(
    (item: { name: string }) => item.name === "Branch from formal",
  );
  expect(branchedCandidate.content).toBe(originalRules);
  expect(branchedCandidate.locked).toBe(false);
  expect(
    branchTarget.candidates.find(
      (item: { name: string }) => item.name === "Candidate B",
    ).content,
  ).toBe(candidateRules);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    formalBeforeDiscard,
  );
  const discardBranchDraft = page.waitForEvent("dialog");
  const discardBranchClick = page
    .getByRole("button", { name: "还原已保存内容" })
    .click();
  const discardBranchDialog = await discardBranchDraft;
  expect(discardBranchDialog.message()).toContain("放弃当前未保存修改");
  await discardBranchDialog.accept();
  await discardBranchClick;

  const scanRequests: string[] = [];
  const observeWorkspaceScan = (
    request: import("@playwright/test").Request,
  ) => {
    if (
      request.url().endsWith("/api/workspaces/scan") &&
      request.method() === "POST"
    ) {
      scanRequests.push(request.url());
    }
  };
  page.on("request", observeWorkspaceScan);
  const scanDraft = `${candidateRules}draft survives a workspace scan\n`;
  await page.getByLabel("方案内容").fill(scanDraft);
  const cancelledScanConfirmation = page.waitForEvent("dialog");
  const cancelledScanClick = page
    .getByRole("button", { name: "重新扫描当前工作空间" })
    .click();
  const cancelledScanDialog = await cancelledScanConfirmation;
  expect(cancelledScanDialog.message()).toContain("未保存修改");
  await cancelledScanDialog.dismiss();
  await cancelledScanClick;
  expect(scanRequests).toHaveLength(0);
  await expect(page.getByLabel("方案内容")).toHaveValue(scanDraft);

  const scanResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/workspaces/scan") &&
      response.request().method() === "POST",
  );
  const scanConfirmation = page.waitForEvent("dialog");
  const scanClick = page
    .getByRole("button", { name: "重新扫描当前工作空间" })
    .click();
  const scanDialog = await scanConfirmation;
  expect(scanDialog.message()).toContain("未保存修改");
  await scanDialog.accept();
  const scanResponse = await scanResponsePromise;
  expect(scanResponse.ok()).toBe(true);
  await scanClick;
  expect(scanRequests).toHaveLength(1);
  page.off("request", observeWorkspaceScan);
  await expect(page.getByLabel("方案内容")).toHaveValue(scanDraft);
  await page.getByLabel("方案内容").fill(candidateRules);

  const unsupportedSource = path.join(testRoot, "unsupported prompt.txt");
  await writeFile(unsupportedSource, "This is not Markdown.\n", "utf8");
  const candidatesBeforeUnsupportedImportResponse =
    await page.request.get("/api/state");
  const candidatesBeforeUnsupportedImportState =
    await candidatesBeforeUnsupportedImportResponse.json();
  const candidatesBeforeUnsupportedImport =
    candidatesBeforeUnsupportedImportState.targets
      .find((item: { path: string }) => item.path === workspace)
      .candidates.map((item: { id: string }) => item.id);
  await page.getByRole("button", { name: "从 Markdown Fork 缓存方案" }).click();
  await page
    .getByLabel("选择 Markdown 文件以 Fork 缓存方案")
    .setInputFiles(unsupportedSource);
  await expect(page.locator(".toast-error")).toContainText(
    "只能导入 .md 或 .markdown 文件",
  );
  await expect(page.getByLabel("方案内容")).toHaveValue(candidateRules);
  const candidatesAfterUnsupportedImportResponse =
    await page.request.get("/api/state");
  const candidatesAfterUnsupportedImportState =
    await candidatesAfterUnsupportedImportResponse.json();
  expect(
    candidatesAfterUnsupportedImportState.targets
      .find((item: { path: string }) => item.path === workspace)
      .candidates.map((item: { id: string }) => item.id),
  ).toEqual(candidatesBeforeUnsupportedImport);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    originalRules,
  );
  await page.getByRole("button", { name: "关闭提示" }).click();

  const importedSource = path.join(testRoot, "legacy prompt.md");
  const importedRules = "# Imported legacy prompt\n\nDo not modify source.\n";
  await writeFile(importedSource, importedRules, "utf8");
  await page.getByRole("button", { name: "从 Markdown Fork 缓存方案" }).click();
  await page.getByLabel("选择 Markdown 文件以 Fork 缓存方案").setInputFiles(importedSource);
  await expect(page.getByLabel("方案名称")).toHaveValue("legacy prompt");
  await expect(page.getByLabel("方案内容")).toHaveValue(importedRules);
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
  await page.getByRole("button", { name: "Candidate B 缓存方案" }).click();

  const unsavedDraft = `${candidateRules}do not discard without confirmation\n`;
  await page.getByLabel("方案内容").fill(unsavedDraft);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "legacy prompt 缓存方案" }).click();
  await expect(page.getByLabel("方案内容")).toHaveValue(unsavedDraft);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "legacy prompt 缓存方案" }).click();
  await expect(page.getByLabel("方案内容")).toHaveValue(importedRules);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    originalRules,
  );
  await page.getByRole("button", { name: "Candidate B 缓存方案" }).click();
  await expect(page.getByLabel("方案内容")).toHaveValue(candidateRules);

  const comparisonDraft = `${candidateRules}comparison draft only\n`;
  await page.getByLabel("方案内容").fill(comparisonDraft);
  await page.getByRole("button", { name: "与其他缓存方案对比" }).click();
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
  await page.getByRole("button", { name: "关闭方案对比" }).click();
  await expect(page.getByRole("heading", { name: "缓存方案对比" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("方案内容")).toHaveValue(comparisonDraft);
  await page.getByRole("button", { name: "与其他缓存方案对比" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "缓存方案对比" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("方案内容")).toHaveValue(comparisonDraft);
  await page.getByRole("button", { name: "与其他缓存方案对比" }).click();
  await page
    .getByLabel("对比基准版本")
    .selectOption({ label: "legacy prompt" });
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
  await page.getByRole("button", { name: "返回方案" }).click();
  await page.getByLabel("方案内容").fill(candidateRules);
  await expect(page.getByText(/所有更改已保存/)).toBeVisible();

  await page.getByLabel("方案内容").fill("");
  await page.getByRole("button", { name: "与其他缓存方案对比" }).click();
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
  await page.getByRole("button", { name: "返回方案" }).click();
  await page.getByLabel("方案内容").fill(candidateRules);
  await expect(page.getByText(/所有更改已保存/)).toBeVisible();

  const exportedDraft = `${candidateRules}export-only draft\n`;
  await page.getByLabel("方案名称").fill("Candidate/B*");
  await page.getByLabel("方案内容").fill(exportedDraft);
  const candidateBeforeCopyResponse = await page.request.get("/api/state");
  const candidateBeforeCopyState = await candidateBeforeCopyResponse.json();
  const candidateBeforeCopyTarget = candidateBeforeCopyState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  const candidateBeforeCopy = candidateBeforeCopyTarget.candidates.find(
    (item: { name: string }) => item.name === "Candidate B",
  );
  const historyBeforeCopyResponse = await page.request.get(
    `/api/candidates/${encodeURIComponent(candidateBeforeCopy.id)}/history?${new URLSearchParams({ path: workspace })}`,
  );
  const historyBeforeCopy = await historyBeforeCopyResponse.json();
  const formalBeforeCopy = await readFile(
    path.join(workspace, "AGENTS.md"),
    "utf8",
  );
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.clock.install();
  await page.getByRole("button", { name: "复制内容" }).click();
  await expect(page.getByRole("button", { name: "已复制" })).toBeVisible();
  await page.clock.fastForward(1_000);
  await page
    .locator('.editor-footer button[title^="复制当前编辑器内容"]')
    .click();
  await expect(page.getByRole("button", { name: "已复制" })).toBeVisible();
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).replace(
      /\r\n/g,
      "\n",
    ),
  ).toBe(exportedDraft);
  await page.clock.fastForward(1_000);
  await expect(page.getByRole("button", { name: "已复制" })).toBeVisible();
  await page.clock.fastForward(800);
  await expect(page.getByRole("button", { name: "复制内容" })).toBeVisible();
  await page.getByRole("button", { name: "复制内容" }).click();
  await expect(page.getByRole("button", { name: "已复制" })).toBeVisible();
  const stateAfterCopyResponse = await page.request.get("/api/state");
  const stateAfterCopy = await stateAfterCopyResponse.json();
  const targetAfterCopy = stateAfterCopy.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(
    targetAfterCopy.candidates.find(
      (item: { id: string }) => item.id === candidateBeforeCopy.id,
    ).content,
  ).toBe(candidateRules);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    formalBeforeCopy,
  );
  const historyAfterCopyResponse = await page.request.get(
    `/api/candidates/${encodeURIComponent(candidateBeforeCopy.id)}/history?${new URLSearchParams({ path: workspace })}`,
  );
  expect(await historyAfterCopyResponse.json()).toEqual(historyBeforeCopy);
  await page.getByRole("button", { name: "复制路径" }).click();
  await expect(page.getByRole("button", { name: "路径已复制" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    path.join(workspace, "AGENTS.md"),
  );
  const stateAfterPathCopyResponse = await page.request.get("/api/state");
  const stateAfterPathCopy = await stateAfterPathCopyResponse.json();
  const targetAfterPathCopy = stateAfterPathCopy.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(
    targetAfterPathCopy.candidates.find(
      (item: { id: string }) => item.id === candidateBeforeCopy.id,
    ).content,
  ).toBe(candidateRules);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    formalBeforeCopy,
  );
  const historyAfterPathCopyResponse = await page.request.get(
    `/api/candidates/${encodeURIComponent(candidateBeforeCopy.id)}/history?${new URLSearchParams({ path: workspace })}`,
  );
  expect(await historyAfterPathCopyResponse.json()).toEqual(historyBeforeCopy);
  if (process.env.PROMPTDOCK_FORMAL_PATH_SCREENSHOT_PATH) {
    await page.screenshot({
      path: process.env.PROMPTDOCK_FORMAL_PATH_SCREENSHOT_PATH,
    });
  }
  await page.setViewportSize({ width: 800, height: 720 });
  const formalCard = page.locator(".formal-card");
  await formalCard.scrollIntoViewIfNeeded();
  const formalCardBounds = await formalCard.evaluate((card) => {
    const rect = card.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    };
  });
  expect(formalCardBounds.left).toBeGreaterThanOrEqual(0);
  expect(formalCardBounds.right).toBeLessThanOrEqual(800);
  expect(formalCardBounds.top).toBeGreaterThanOrEqual(0);
  expect(formalCardBounds.bottom).toBeLessThanOrEqual(720);
  const copiedFormalPathButton = page.getByRole("button", {
    name: "路径已复制",
  });
  await copiedFormalPathButton.scrollIntoViewIfNeeded();
  const formalPathButtonBounds = await copiedFormalPathButton.evaluate(
    (button) => {
      const rect = button.getBoundingClientRect();
      const hitTarget = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        receivesPointer: hitTarget === button || button.contains(hitTarget),
      };
    },
  );
  expect(formalPathButtonBounds.left).toBeGreaterThanOrEqual(0);
  expect(formalPathButtonBounds.right).toBeLessThanOrEqual(800);
  expect(formalPathButtonBounds.top).toBeGreaterThanOrEqual(0);
  expect(formalPathButtonBounds.bottom).toBeLessThanOrEqual(720);
  expect(formalPathButtonBounds.receivesPointer).toBe(true);
  await copiedFormalPathButton.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    path.join(workspace, "AGENTS.md"),
  );
  if (process.env.PROMPTDOCK_FORMAL_PATH_NARROW_SCREENSHOT_PATH) {
    await page.screenshot({
      path: process.env.PROMPTDOCK_FORMAL_PATH_NARROW_SCREENSHOT_PATH,
    });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  if (process.env.PROMPTDOCK_COPY_BUTTON_SCREENSHOT_PATH) {
    await page.screenshot({
      path: process.env.PROMPTDOCK_COPY_BUTTON_SCREENSHOT_PATH,
    });
  }
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async () => {
        throw new Error("simulated clipboard denial");
      },
    });
  });
  await page
    .locator('.editor-footer button[title^="复制当前编辑器内容"]')
    .click();
  await expect(page.locator(".toast-error")).toContainText(
    "复制到剪贴板失败：simulated clipboard denial",
  );
  await expect(page.getByRole("button", { name: "复制内容" })).toBeVisible();
  const stateAfterCopyFailureResponse = await page.request.get("/api/state");
  const stateAfterCopyFailure = await stateAfterCopyFailureResponse.json();
  const targetAfterCopyFailure = stateAfterCopyFailure.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(
    targetAfterCopyFailure.candidates.find(
      (item: { id: string }) => item.id === candidateBeforeCopy.id,
    ).content,
  ).toBe(candidateRules);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    formalBeforeCopy,
  );
  const historyAfterCopyFailureResponse = await page.request.get(
    `/api/candidates/${encodeURIComponent(candidateBeforeCopy.id)}/history?${new URLSearchParams({ path: workspace })}`,
  );
  expect(await historyAfterCopyFailureResponse.json()).toEqual(
    historyBeforeCopy,
  );
  await page.getByRole("button", { name: "关闭提示" }).click();
  await page.setViewportSize({ width: 800, height: 720 });
  if (process.env.PROMPTDOCK_COPY_BUTTON_NARROW_SCREENSHOT_PATH) {
    await page.screenshot({
      path: process.env.PROMPTDOCK_COPY_BUTTON_NARROW_SCREENSHOT_PATH,
    });
  }
  for (const label of [
    "复制内容",
    "导出 Markdown",
    "还原已保存内容",
    "保存方案",
  ]) {
    await expect(page.getByRole("button", { name: label })).toBeInViewport();
  }
  const actionBounds = await page
    .locator(".editor-footer .heading-actions button")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        const hitTarget = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          receivesPointer: hitTarget === button || button.contains(hitTarget),
        };
      }),
    );
  expect(actionBounds).toHaveLength(4);
  for (const [index, button] of actionBounds.entries()) {
    expect(button.left).toBeGreaterThanOrEqual(0);
    expect(button.right).toBeLessThanOrEqual(800);
    expect(button.top).toBeGreaterThanOrEqual(0);
    expect(button.bottom).toBeLessThanOrEqual(720);
    expect(button.receivesPointer).toBe(true);
    if (index > 0)
      expect(actionBounds[index - 1].right).toBeLessThanOrEqual(button.left);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
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
  await page.getByLabel("方案名称").fill("Candidate B");
  await page.getByLabel("方案内容").fill(candidateRules);
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

  await page.getByRole("button", { name: "与其他缓存方案对比" }).click();
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
  await page.getByRole("button", { name: "返回方案" }).click();

  await page.getByRole("button", { name: "切换为正式规则" }).click();
  await expect(
    page.getByRole("heading", { name: "确认切换为正式规则" }),
  ).toBeVisible();
  await expect(page.getByLabel("磁盘文件切换差异")).toContainText(
    "candidate only",
  );
  if (process.env.PROMPTDOCK_SWITCH_PREVIEW_SCREENSHOT_PATH) {
    await page.screenshot({
      path: process.env.PROMPTDOCK_SWITCH_PREVIEW_SCREENSHOT_PATH,
    });
  }
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    originalRules,
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "确认切换为正式规则" }),
  ).toHaveCount(0);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    originalRules,
  );

  await page.getByRole("button", { name: "切换为正式规则" }).click();
  await page.getByRole("button", { name: "关闭切换预览" }).click();
  await expect(
    page.getByRole("heading", { name: "确认切换为正式规则" }),
  ).toHaveCount(0);
  const stateAfterClosingPreview = await page.request.get("/api/state");
  const targetAfterClosingPreview = (
    await stateAfterClosingPreview.json()
  ).targets.find((item: { path: string }) => item.path === workspace);
  expect(
    targetAfterClosingPreview.candidates.find(
      (item: { name: string }) => item.name === "Candidate B",
    ).locked,
  ).toBe(false);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    originalRules,
  );

  await page.getByRole("button", { name: "切换为正式规则" }).click();
  const lockCandidatePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/candidates/lock") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "确认切换正式规则" }).click();
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
  const lockedHistoryUrl = `/api/candidates/${encodeURIComponent(candidateB.id)}/history?${new URLSearchParams({ path: workspace })}`;
  const lockedHistoryBeforeRestoreResponse =
    await page.request.get(lockedHistoryUrl);
  const lockedHistoryBeforeRestore =
    await lockedHistoryBeforeRestoreResponse.json();
  const formalBeforeRestore = await readFile(
    path.join(workspace, "AGENTS.md"),
    "utf8",
  );
  await page.getByLabel("方案名称").fill("Unsaved locked name");
  await page
    .getByLabel("方案内容")
    .fill(`${candidateRules}unsaved locked draft\n`);
  const lockedRestoreConfirmation = page.waitForEvent("dialog");
  const lockedRestoreClick = page
    .getByRole("button", { name: "还原已保存内容" })
    .click();
  const lockedRestoreDialog = await lockedRestoreConfirmation;
  await lockedRestoreDialog.accept();
  await lockedRestoreClick;
  await expect(page.getByLabel("方案名称")).toHaveValue("Candidate B");
  await expect(page.getByLabel("方案内容")).toHaveValue(candidateRules);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    formalBeforeRestore,
  );
  const lockedHistoryAfterRestoreResponse =
    await page.request.get(lockedHistoryUrl);
  expect(await lockedHistoryAfterRestoreResponse.json()).toEqual(
    lockedHistoryBeforeRestore,
  );
  const lockedRules = `${candidateRules}locked candidate edit\n`;
  await page.getByLabel("方案内容").fill(lockedRules);
  await expect(
    page.getByRole("button", { name: "保存当前方案并同步磁盘文件" }),
  ).toBeEnabled();
  const lockedSavePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/candidates") &&
      response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "保存当前方案并同步磁盘文件" }).click();
  const lockedSaveResponse = await lockedSavePromise;
  expect(lockedSaveResponse.ok()).toBe(true);
  await expect(page.getByText(/所有更改已保存/)).toBeVisible();
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    lockedRules,
  );
  await page.getByLabel("方案内容").fill(conflictDraft);
  await writeFile(path.join(workspace, "AGENTS.md"), externalRules, "utf8");
  const conflictScanConfirmation = page.waitForEvent("dialog");
  const conflictScanClick = page
    .getByRole("button", { name: "重新扫描当前工作空间" })
    .click();
  const conflictScanDialog = await conflictScanConfirmation;
  expect(conflictScanDialog.message()).toContain("未保存修改");
  await conflictScanDialog.accept();
  await conflictScanClick;
  await expect(
    page.getByRole("heading", { name: "规则文件冲突" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "还原已保存内容" }),
  ).toHaveCount(0);
  if (process.env.PROMPTDOCK_CONFLICT_SCREENSHOT_PATH) {
    await page.screenshot({
      path: process.env.PROMPTDOCK_CONFLICT_SCREENSHOT_PATH,
    });
  }
  await expect(page.getByText("external only", { exact: true })).toBeVisible();
  await expect(page.getByText("candidate only", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "并排原文" }).click();
  await expect(page.locator(".compare-panel")).toHaveCount(2);
  await page.getByRole("button", { name: "标记差异" }).click();
  await page.getByRole("button", { name: "把磁盘文件放入解决稿" }).click();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(externalRules);
  await page.getByRole("button", { name: "把当前方案放入解决稿" }).click();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(lockedRules);
  await page.getByRole("button", { name: "把未保存草稿放入解决稿" }).click();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(conflictDraft);
  const conflictRescanRequests: string[] = [];
  const observeConflictRescan = (
    request: import("@playwright/test").Request,
  ) => {
    if (
      request.url().endsWith("/api/workspaces/scan") &&
      request.method() === "POST"
    ) {
      conflictRescanRequests.push(request.url());
    }
  };
  page.on("request", observeConflictRescan);
  await writeFile(
    path.join(workspace, "AGENTS.md"),
    refreshedExternalRules,
    "utf8",
  );
  const cancelledConflictRescanConfirmation = page.waitForEvent("dialog");
  const cancelledConflictRescanClick = page
    .getByRole("button", { name: "重新扫描当前工作空间" })
    .click();
  const cancelledConflictRescanDialog =
    await cancelledConflictRescanConfirmation;
  expect(cancelledConflictRescanDialog.message()).toContain("冲突解决稿");
  await cancelledConflictRescanDialog.dismiss();
  await cancelledConflictRescanClick;
  expect(conflictRescanRequests).toHaveLength(0);
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(conflictDraft);

  const conflictRescanResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/workspaces/scan") &&
      response.request().method() === "POST",
  );
  const conflictRescanConfirmation = page.waitForEvent("dialog");
  const conflictRescanClick = page
    .getByRole("button", { name: "重新扫描当前工作空间" })
    .click();
  const conflictRescanDialog = await conflictRescanConfirmation;
  expect(conflictRescanDialog.message()).toContain("冲突解决稿");
  await conflictRescanDialog.accept();
  const conflictRescanResponse = await conflictRescanResponsePromise;
  expect(conflictRescanResponse.ok()).toBe(true);
  await conflictRescanClick;
  expect(conflictRescanRequests).toHaveLength(1);
  page.off("request", observeConflictRescan);
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(conflictDraft);
  await page.getByRole("button", { name: "把磁盘文件放入解决稿" }).click();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(
    refreshedExternalRules,
  );
  await page.getByRole("button", { name: "把未保存草稿放入解决稿" }).click();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(conflictDraft);
  await page.getByLabel("新缓存方案名称（仅新建方案时使用）").fill("Merged rules");
  await page.getByLabel("冲突解决内容").fill(mergedRules);
  await page.getByRole("button", { name: "保存为新缓存方案" }).click();
  await expect(page.getByText("磁盘与当前方案一致", { exact: true })).toBeVisible();

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

  await page.getByRole("button", { name: "Candidate B 缓存方案" }).click();
  const historyComparisonDraft = `${lockedRules}unsaved history draft\n`;
  await page.getByLabel("方案内容").fill(historyComparisonDraft);
  await page.getByRole("button", { name: "查看历史版本" }).click();
  await expect(page.locator(".history-revision")).toHaveCount(3);
  await page.getByRole("button", { name: "关闭历史版本" }).click();
  await expect(
    page.getByRole("heading", { name: "Candidate B 的历史版本" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("方案内容")).toHaveValue(historyComparisonDraft);
  await page.getByRole("button", { name: "查看历史版本" }).click();
  await expect(page.locator(".history-revision")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Candidate B 的历史版本" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("方案内容")).toHaveValue(historyComparisonDraft);
  await page.getByRole("button", { name: "查看历史版本" }).click();
  await expect(page.locator(".history-revision")).toHaveCount(3);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Candidate B 的历史版本" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("方案内容")).toHaveValue(historyComparisonDraft);
  await page.getByRole("button", { name: "查看历史版本" }).click();
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
    .getByRole("button", { name: "Fork 此历史版本为缓存方案" })
    .click();
  const cancelledRestoreDialog = await cancelledRestoreConfirmation;
  expect(cancelledRestoreDialog.message()).toContain("有未保存修改");
  await cancelledRestoreDialog.dismiss();
  await cancelledRestoreClick;
  await expect(
    page.getByRole("heading", { name: "Candidate B 的历史版本" }),
  ).toBeVisible();
  await expect(page.getByLabel("方案内容")).toHaveValue(historyComparisonDraft);
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
    .getByRole("button", { name: "Fork 此历史版本为缓存方案" })
    .click();
  const restoreDialog = await restoreConfirmation;
  expect(restoreDialog.message()).toContain("有未保存修改");
  await restoreDialog.accept();
  await restoreClick;
  await expect(page.getByLabel("方案名称")).toHaveValue(
    "Candidate B（历史恢复）",
  );
  await expect(page.getByLabel("方案内容")).toHaveValue(originalRules);
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
  const candidateSearch = page.getByLabel("筛选缓存方案");
  await candidateSearch.fill("Merged");
  await expect(page.locator(".candidate-row")).toHaveCount(1);
  await candidateSearch.fill("review locally");
  await expect(page.locator(".candidate-row")).toHaveCount(1);
  await candidateSearch.fill("does not exist");
  await expect(page.locator(".candidate-row")).toHaveCount(0);

  await writeFile(
    path.join(workspace, "AGENTS.md"),
    navigationConflictRules,
    "utf8",
  );
  await page.getByRole("button", { name: "重新扫描当前工作空间" }).click();
  await expect(
    page.getByRole("heading", { name: "规则文件冲突" }),
  ).toBeVisible();
  const resolutionNavigationDraft = `${navigationConflictRules}unsaved resolution navigation\n`;
  await page.getByLabel("冲突解决内容").fill(resolutionNavigationDraft);
  const workspaceSwitchConfirmation = page.waitForEvent("dialog");
  const workspaceSwitchClick = page
    .getByRole("button", { name: /用户级规则/ })
    .click();
  const workspaceSwitchDialog = await workspaceSwitchConfirmation;
  expect(workspaceSwitchDialog.message()).toContain("冲突解决稿");
  await workspaceSwitchDialog.dismiss();
  await workspaceSwitchClick;
  await expect(
    page.getByRole("heading", { name: "规则文件冲突" }),
  ).toBeVisible();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(
    resolutionNavigationDraft,
  );
  const acceptedWorkspaceSwitch = page.waitForEvent("dialog");
  const acceptedWorkspaceClick = page
    .getByRole("button", { name: /用户级规则/ })
    .click();
  const acceptedWorkspaceDialog = await acceptedWorkspaceSwitch;
  expect(acceptedWorkspaceDialog.message()).toContain("冲突解决稿");
  await acceptedWorkspaceDialog.accept();
  await acceptedWorkspaceClick;
  await page
    .getByRole("button", { name: "project-rules", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "规则文件冲突" }),
  ).toBeVisible();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(
    navigationConflictRules,
  );
  await page.getByLabel("新缓存方案名称（仅新建方案时使用）").fill("Unsaved name only");
  const nameOnlySwitchConfirmation = page.waitForEvent("dialog");
  const nameOnlySwitchClick = page
    .getByRole("button", { name: /用户级规则/ })
    .click();
  const nameOnlySwitchDialog = await nameOnlySwitchConfirmation;
  expect(nameOnlySwitchDialog.message()).toContain("冲突解决稿");
  await nameOnlySwitchDialog.dismiss();
  await nameOnlySwitchClick;
  await expect(page.getByLabel("新缓存方案名称（仅新建方案时使用）")).toHaveValue(
    "Unsaved name only",
  );
  const acceptedNameOnlySwitch = page.waitForEvent("dialog");
  const acceptedNameOnlyClick = page
    .getByRole("button", { name: /用户级规则/ })
    .click();
  const acceptedNameOnlyDialog = await acceptedNameOnlySwitch;
  await acceptedNameOnlyDialog.accept();
  await acceptedNameOnlyClick;
  await page
    .getByRole("button", { name: "project-rules", exact: true })
    .click();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(
    navigationConflictRules,
  );
  await expect(page.getByLabel("新缓存方案名称（仅新建方案时使用）")).toHaveValue("冲突解决结果");
  await page.getByRole("button", { name: "把磁盘文件放入解决稿" }).click();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(
    navigationConflictRules,
  );
  await page.getByLabel("新缓存方案名称（仅新建方案时使用）").fill("Navigation conflict fix");
  await page.getByRole("button", { name: "保存为新缓存方案" }).click();
  await expect(page.getByText("磁盘与当前方案一致", { exact: true })).toBeVisible();
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    navigationConflictRules,
  );
});

test("缓存方案来源默认保留未保存草稿，干净时分支会打开且有 Git 历史", async ({
  page,
}) => {
  const formalRules = "# Formal rules\nKeep the approved behavior.\n";
  const unsavedDraft = `${formalRules}\nExperiment from current draft.\n`;
  const workspace = await makeWorkspace("candidate-source", formalRules);

  await page.goto("/");
  await addWorkspace(page, workspace);
  await page.getByLabel("方案内容").fill(unsavedDraft);
  await page.getByRole("button", { name: "新建缓存方案" }).click();
  await expect(page.getByLabel("方案内容来源")).toHaveValue("");
  await page.getByLabel("新方案名称").fill("From unsaved draft");
  await page.getByRole("button", { name: "创建缓存方案" }).click();
  await expect(
    page.getByRole("textbox", { name: "方案名称", exact: true }),
  ).toHaveValue("From unsaved draft");
  await expect(page.getByLabel("方案内容")).toHaveValue(unsavedDraft);
  const afterDraftCreateResponse = await page.request.get("/api/state");
  const afterDraftCreate = await afterDraftCreateResponse.json();
  const targetAfterDraftCreate = afterDraftCreate.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  const lockedCandidate = targetAfterDraftCreate.candidates.find(
    (item: { locked: boolean }) => item.locked,
  );
  expect(
    targetAfterDraftCreate.candidates.find(
      (item: { name: string }) => item.name === "From unsaved draft",
    ).content,
  ).toBe(unsavedDraft);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    formalRules,
  );

  await page.getByRole("button", { name: "新建缓存方案" }).click();
  await page.getByLabel("方案内容来源").selectOption(lockedCandidate.id);
  await page.getByLabel("新方案名称").fill("Clean branch from formal");
  await page.getByRole("button", { name: "创建缓存方案" }).click();
  await expect(
    page.getByRole("textbox", { name: "方案名称", exact: true }),
  ).toHaveValue("Clean branch from formal");
  await expect(
    page.getByRole("textbox", { name: "方案内容", exact: true }),
  ).toHaveValue(formalRules);
  const afterCleanBranchResponse = await page.request.get("/api/state");
  const afterCleanBranch = await afterCleanBranchResponse.json();
  const targetAfterCleanBranch = afterCleanBranch.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  const cleanBranch = targetAfterCleanBranch.candidates.find(
    (item: { name: string }) => item.name === "Clean branch from formal",
  );
  expect(cleanBranch.content).toBe(formalRules);
  expect(cleanBranch.locked).toBe(false);
  const historyResponse = await page.request.get(
    `/api/candidates/${encodeURIComponent(cleanBranch.id)}/history?${new URLSearchParams({ path: workspace })}`,
  );
  expect(historyResponse.ok()).toBe(true);
  const revisions = await historyResponse.json();
  expect(revisions.length).toBeGreaterThan(0);
  const revisionResponse = await page.request.get(
    `/api/candidates/${encodeURIComponent(cleanBranch.id)}/history/${encodeURIComponent(revisions[0].commit)}?${new URLSearchParams({ path: workspace })}`,
  );
  expect(revisionResponse.ok()).toBe(true);
  expect(await revisionResponse.json()).toEqual({
    content: formalRules,
    name: "Clean branch from formal",
  });
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    formalRules,
  );
});

test("空目录初始化后，移除工作空间保留文件并可重新添加", async ({ page }) => {
  const workspace = await makeWorkspace("empty-project");
  await page.goto("/");
  await addWorkspace(page, workspace);
  await expect(
    page.getByRole("heading", { name: "把规则版本，清楚地管起来。" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "添加工作空间" }).last().click();
  await expect(
    page.getByRole("heading", { name: "添加工作空间" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("heading", { name: "添加工作空间" })).toHaveCount(
    0,
  );
  await expect(page.getByText("没有发现 AGENTS.md")).toBeVisible();
  await page.getByRole("button", { name: "初始化 AGENTS.md" }).click();
  await expect(page.getByLabel("方案内容")).toHaveValue("# AGENTS.md\n");
  const formalFile = path.join(workspace, "AGENTS.md");
  expect(await readFile(formalFile, "utf8")).toBe("# AGENTS.md\n");

  const nestedDirectory = path.join(workspace, "nested");
  await mkdir(nestedDirectory);
  const nestedFormalFile = path.join(nestedDirectory, "AGENTS.md");
  await page.getByRole("button", { name: "初始化目录" }).click();
  await page.getByLabel("目录路径").fill(nestedDirectory);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("heading", { name: "初始化目录" })).toHaveCount(
    0,
  );
  await expect(readFile(nestedFormalFile, "utf8")).rejects.toThrow();
  await page.getByRole("button", { name: "初始化目录" }).click();
  await page.getByLabel("目录路径").fill(nestedDirectory);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "初始化目录" })).toHaveCount(
    0,
  );
  await expect(readFile(nestedFormalFile, "utf8")).rejects.toThrow();
  await page.getByRole("button", { name: "初始化目录" }).click();
  await expect(page.getByRole("heading", { name: "初始化目录" })).toBeVisible();
  await page.getByLabel("目录路径").fill(nestedDirectory);
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("heading", { name: "初始化目录" })).toHaveCount(
    0,
  );
  await expect(readFile(nestedFormalFile, "utf8")).rejects.toThrow();
  await page.getByRole("button", { name: "初始化目录" }).click();
  await page.getByLabel("目录路径").fill(nestedDirectory);
  await page.getByRole("button", { name: "初始化并同步" }).click();
  await expect(page.getByRole("heading", { name: "初始化目录" })).toHaveCount(
    0,
  );
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
  await expect(page.getByLabel("方案内容")).toHaveValue("# AGENTS.md\n");
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

  const discoveredDirectory = path.join(
    workspace,
    "discovered-later",
    "nested",
    "deeper",
  );
  await mkdir(discoveredDirectory, { recursive: true });
  const discoveredRules = "# Discovered on startup\n";
  await writeFile(
    path.join(discoveredDirectory, "AGENTS.md"),
    discoveredRules,
    "utf8",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "empty-project", exact: true })
    .click();
  await expect(page.locator(".rule-row")).toHaveCount(3);
  await page.getByRole("button", { name: /discovered-later/ }).click();
  await expect(page.getByLabel("方案内容")).toHaveValue(discoveredRules);
  expect(
    await readFile(path.join(discoveredDirectory, "AGENTS.md"), "utf8"),
  ).toBe(discoveredRules);
});

test("同名工作空间按父路径区分且移除确认指向正确路径", async ({ page }) => {
  const firstWorkspace = await makeWorkspace(
    path.join("parent-one", "shared-project"),
    "first workspace rules\n",
  );
  const secondWorkspace = await makeWorkspace(
    path.join("parent-two", "shared-project"),
    "second workspace rules\n",
  );

  await page.goto("/");
  await addWorkspace(page, firstWorkspace);
  await page.getByRole("button", { name: "添加工作空间" }).first().click();
  await page.getByPlaceholder("选择文件夹，或输入本机路径").fill(secondWorkspace);
  await page.getByRole("button", { name: "添加并扫描" }).click();
  await expect(page.getByRole("heading", { name: "添加工作空间" })).toHaveCount(
    0,
  );
  const firstWorkspaceButton = page.locator(
    '.workspace-row[aria-label*="parent-one"]',
  );
  const secondWorkspaceButton = page.locator(
    '.workspace-row[aria-label*="parent-two"]',
  );
  await expect(firstWorkspaceButton).toBeVisible();
  await expect(secondWorkspaceButton).toBeVisible();
  if (process.env.PROMPTDOCK_DUPLICATE_WORKSPACE_SCREENSHOT_PATH) {
    await page.screenshot({
      path: process.env.PROMPTDOCK_DUPLICATE_WORKSPACE_SCREENSHOT_PATH,
    });
  }
  await firstWorkspaceButton.click();
  await expect(firstWorkspaceButton).toHaveClass(/active/);
  await expect(page.getByLabel("方案内容")).toHaveValue(
    "first workspace rules\n",
  );

  const removeSecondWorkspace = page.locator(
    '.workspace-remove[aria-label*="parent-two"]',
  );
  const removalDialogPromise = page.waitForEvent("dialog");
  const removeClickPromise = removeSecondWorkspace.click();
  const removalDialog = await removalDialogPromise;
  expect(removalDialog.message()).toContain("parent-two");
  expect(removalDialog.message()).not.toContain("parent-one");
  await removalDialog.accept();
  await removeClickPromise;

  const stateResponse = await page.request.get("/api/state");
  const state = await stateResponse.json();
  expect(state.workspaces).toContain(firstWorkspace);
  expect(state.workspaces).not.toContain(secondWorkspace);
  await expect(firstWorkspaceButton).toBeVisible();
  await expect(secondWorkspaceButton).toHaveCount(0);
  await expect(page.getByLabel("方案内容")).toHaveValue(
    "first workspace rules\n",
  );
  expect(await readFile(path.join(secondWorkspace, "AGENTS.md"), "utf8")).toBe(
    "second workspace rules\n",
  );
});

test("未保存冲突解决稿保护规则路径切换、添加和移除操作", async ({ page }) => {
  const workspace = await makeWorkspace("navigation-rules", "initial formal\n");
  const childDirectory = path.join(workspace, "nested");
  await mkdir(childDirectory, { recursive: true });
  await writeFile(
    path.join(childDirectory, "AGENTS.md"),
    "nested rules\n",
    "utf8",
  );
  const newWorkspace = await makeWorkspace("navigation-added-workspace");
  const formalFile = path.join(workspace, "AGENTS.md");
  const externalFormal = "external formal update\n";

  await page.goto("/");
  await addWorkspace(page, workspace);
  const ruleFilter = page.getByLabel("筛选规则路径");
  await expect(page.locator(".rule-row")).toHaveCount(2);
  await ruleFilter.fill("nested");
  await expect(page.locator(".rule-row")).toHaveCount(1);
  await expect(page.locator(".rule-row")).toContainText("nested");
  await ruleFilter.fill("");
  await expect(page.locator(".rule-row")).toHaveCount(2);
  const rootRule = page.getByRole("button", {
    name: "AGENTS.md",
    exact: true,
  });
  await rootRule.click();
  await writeFile(formalFile, externalFormal, "utf8");
  await page.getByRole("button", { name: "重新扫描当前工作空间" }).click();
  await expect(
    page.getByRole("heading", { name: "规则文件冲突" }),
  ).toBeVisible();

  await page.getByLabel("冲突解决内容").fill("");
  await expect(page.getByTestId("resolution-content-stats")).toHaveText(
    "1 行 · 0 字符 · 0 UTF-8 字节",
  );
  await page.getByLabel("冲突解决内容").fill("first\n中文🌍\n");
  await expect(page.getByTestId("resolution-content-stats")).toHaveText(
    "3 行 · 10 字符 · 17 UTF-8 字节",
  );
  if (process.env.PROMPTDOCK_RESOLUTION_STATS_SCREENSHOT_PATH) {
    await page.getByTestId("resolution-content-stats").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: process.env.PROMPTDOCK_RESOLUTION_STATS_SCREENSHOT_PATH,
    });
  }
  await page.getByRole("button", { name: "关闭提示" }).click();
  await page.setViewportSize({ width: 800, height: 720 });
  const resolutionSaveButton = page.getByRole("button", {
    name: "保存为新缓存方案",
  });
  await resolutionSaveButton.scrollIntoViewIfNeeded();
  await expect(resolutionSaveButton).toBeInViewport();
  const resolutionCopyButton = page.getByRole("button", {
    name: "复制解决稿",
  });
  await resolutionCopyButton.scrollIntoViewIfNeeded();
  await expect(resolutionCopyButton).toBeInViewport();
  const narrowCopyButtonGeometry = await resolutionCopyButton.evaluate(
    (button) => {
      const rect = button.getBoundingClientRect();
      const hitTarget = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        receivesPointer: hitTarget === button || button.contains(hitTarget),
      };
    },
  );
  expect(narrowCopyButtonGeometry.left).toBeGreaterThanOrEqual(0);
  expect(narrowCopyButtonGeometry.right).toBeLessThanOrEqual(800);
  expect(narrowCopyButtonGeometry.top).toBeGreaterThanOrEqual(0);
  expect(narrowCopyButtonGeometry.bottom).toBeLessThanOrEqual(720);
  expect(narrowCopyButtonGeometry.receivesPointer).toBe(true);
  const resolutionFooterGeometry = await page.evaluate(() => {
    const stats = document.querySelector(
      '[data-testid="resolution-content-stats"]',
    );
    const saveButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("保存为新缓存方案"),
    );
    if (
      !(stats instanceof HTMLElement) ||
      !(saveButton instanceof HTMLElement)
    ) {
      throw new Error("冲突统计或保存操作不可见");
    }
    const statsBounds = stats.getBoundingClientRect();
    const buttonBounds = saveButton.getBoundingClientRect();
    const centerX = buttonBounds.left + buttonBounds.width / 2;
    const centerY = buttonBounds.top + buttonBounds.height / 2;
    const hitTarget = document.elementFromPoint(centerX, centerY);
    return {
      statsBottom: statsBounds.bottom,
      buttonTop: buttonBounds.top,
      buttonRight: buttonBounds.right,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      buttonReceivesPointer:
        hitTarget === saveButton || saveButton.contains(hitTarget),
    };
  });
  expect(resolutionFooterGeometry.statsBottom).toBeLessThanOrEqual(
    resolutionFooterGeometry.buttonTop,
  );
  expect(resolutionFooterGeometry.buttonRight).toBeLessThanOrEqual(
    resolutionFooterGeometry.viewportWidth,
  );
  expect(resolutionFooterGeometry.buttonTop).toBeGreaterThanOrEqual(0);
  expect(resolutionFooterGeometry.buttonTop).toBeLessThan(
    resolutionFooterGeometry.viewportHeight,
  );
  expect(resolutionFooterGeometry.buttonReceivesPointer).toBe(true);
  if (process.env.PROMPTDOCK_RESOLUTION_STATS_NARROW_SCREENSHOT_PATH) {
    await page.screenshot({
      path: process.env.PROMPTDOCK_RESOLUTION_STATS_NARROW_SCREENSHOT_PATH,
    });
  }
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await resolutionCopyButton.click();
  await expect(
    page.getByRole("button", { name: "已复制解决稿" }),
  ).toBeVisible();
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).replace(
      /\r\n/g,
      "\n",
    ),
  ).toBe("first\n中文🌍\n");
  await page.setViewportSize({ width: 1280, height: 720 });
  const pathSwitchDraft = "unsaved path switch resolution\n";
  await page.getByLabel("冲突解决内容").fill(pathSwitchDraft);
  const beforeCopyResponse = await page.request.get("/api/state");
  const beforeCopyState = await beforeCopyResponse.json();
  const beforeCopyTarget = beforeCopyState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  const lockedCandidateBeforeCopy = beforeCopyTarget.candidates.find(
    (item: { locked: boolean }) => item.locked,
  );
  const lockedHistoryUrl = `/api/candidates/${encodeURIComponent(lockedCandidateBeforeCopy.id)}/history?${new URLSearchParams({ path: workspace })}`;
  const lockedHistoryBeforeCopyResponse =
    await page.request.get(lockedHistoryUrl);
  const lockedHistoryBeforeCopy = await lockedHistoryBeforeCopyResponse.json();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "复制解决稿" }).click();
  await expect(
    page.getByRole("button", { name: "已复制解决稿" }),
  ).toBeVisible();
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).replace(
      /\r\n/g,
      "\n",
    ),
  ).toBe(pathSwitchDraft);
  expect(await readFile(formalFile, "utf8")).toBe(externalFormal);
  const afterCopyResponse = await page.request.get("/api/state");
  const afterCopyState = await afterCopyResponse.json();
  const afterCopyTarget = afterCopyState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(
    afterCopyTarget.candidates.find(
      (item: { id: string }) => item.id === lockedCandidateBeforeCopy.id,
    ),
  ).toEqual(lockedCandidateBeforeCopy);
  const lockedHistoryAfterCopyResponse =
    await page.request.get(lockedHistoryUrl);
  expect(await lockedHistoryAfterCopyResponse.json()).toEqual(
    lockedHistoryBeforeCopy,
  );

  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async () => {
        throw new Error("simulated clipboard denial");
      },
    });
  });
  await page
    .locator('button[title="复制当前冲突解决稿，包括未保存修改"]')
    .click();
  await expect(page.locator(".toast-error")).toContainText(
    "复制到剪贴板失败：simulated clipboard denial",
  );
  await expect(page.getByRole("button", { name: "复制解决稿" })).toBeVisible();
  await page.getByRole("button", { name: "关闭提示" }).click();

  const beforeUnload = page.waitForEvent("dialog");
  await page.evaluate(() => {
    window.setTimeout(() => window.location.reload(), 0);
  });
  const unloadDialog = await beforeUnload;
  expect(unloadDialog.type()).toBe("beforeunload");
  await unloadDialog.dismiss();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(pathSwitchDraft);
  expect(await readFile(formalFile, "utf8")).toBe(externalFormal);

  const cancelledPathSwitch = page.waitForEvent("dialog");
  const cancelledPathClick = page
    .locator(".rule-row")
    .filter({ hasText: "nested" })
    .click();
  const cancelledPathDialog = await cancelledPathSwitch;
  expect(cancelledPathDialog.message()).toContain("冲突解决稿");
  await cancelledPathDialog.dismiss();
  await cancelledPathClick;
  await expect(
    page.getByRole("heading", { name: "规则文件冲突" }),
  ).toBeVisible();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(pathSwitchDraft);

  const acceptedPathSwitch = page.waitForEvent("dialog");
  const acceptedPathClick = page
    .locator(".rule-row")
    .filter({ hasText: "nested" })
    .click();
  const acceptedPathDialog = await acceptedPathSwitch;
  await acceptedPathDialog.accept();
  await acceptedPathClick;
  await expect(page.getByLabel("方案内容")).toHaveValue("nested rules\n");
  await rootRule.click();
  await expect(
    page.getByRole("heading", { name: "规则文件冲突" }),
  ).toBeVisible();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(externalFormal);

  const addWorkspaceButton = page
    .getByRole("button", {
      name: "添加工作空间",
    })
    .first();
  const addWorkspaceDraft = "unsaved add-workspace resolution\n";
  await page.getByLabel("冲突解决内容").fill(addWorkspaceDraft);
  await addWorkspaceButton.click();
  await page.getByPlaceholder("选择文件夹，或输入本机路径").fill(newWorkspace);
  const cancelledAddConfirmation = page.waitForEvent("dialog");
  const cancelledAddClick = page
    .getByRole("button", { name: "添加并扫描" })
    .click();
  const cancelledAddDialog = await cancelledAddConfirmation;
  expect(cancelledAddDialog.message()).toContain("冲突解决稿");
  await cancelledAddDialog.dismiss();
  await cancelledAddClick;
  await expect(
    page.getByRole("heading", { name: "添加工作空间" }),
  ).toBeVisible();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(addWorkspaceDraft);

  const acceptedAddConfirmation = page.waitForEvent("dialog");
  const acceptedAddClick = page
    .getByRole("button", { name: "添加并扫描" })
    .click();
  const acceptedAddDialog = await acceptedAddConfirmation;
  await acceptedAddDialog.accept();
  await acceptedAddClick;
  await expect(page.getByRole("heading", { name: "添加工作空间" })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "navigation-rules", exact: true })
    .click();
  await rootRule.click();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(externalFormal);

  const removalDraftName = "Unsaved removal draft";
  await page.getByLabel("新缓存方案名称（仅新建方案时使用）").fill(removalDraftName);
  const cancelledRemoval = page.waitForEvent("dialog");
  const cancelledRemovalClick = page
    .getByRole("button", { name: "从列表移除工作空间 navigation-rules" })
    .click();
  const cancelledRemovalDialog = await cancelledRemoval;
  expect(cancelledRemovalDialog.message()).toContain("冲突解决稿");
  await cancelledRemovalDialog.dismiss();
  await cancelledRemovalClick;
  await expect(page.getByLabel("新缓存方案名称（仅新建方案时使用）")).toHaveValue(removalDraftName);
  await expect(
    page.getByRole("button", { name: "navigation-rules", exact: true }),
  ).toBeVisible();

  const acceptedRemoval = page.waitForEvent("dialog");
  const acceptedRemovalClick = page
    .getByRole("button", { name: "从列表移除工作空间 navigation-rules" })
    .click();
  const acceptedRemovalDialog = await acceptedRemoval;
  expect(acceptedRemovalDialog.message()).toContain("冲突解决稿");
  const removalConfirmation = page.waitForEvent("dialog");
  await acceptedRemovalDialog.accept();
  const removalDialog = await removalConfirmation;
  expect(removalDialog.message()).toContain("磁盘文件、缓存方案和历史版本都会保留");
  await removalDialog.accept();
  await acceptedRemovalClick;
  await expect(
    page.getByRole("button", { name: "navigation-rules", exact: true }),
  ).toHaveCount(0);
  expect(await readFile(formalFile, "utf8")).toBe(externalFormal);
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
  await page.getByRole("button", { name: "使用说明与诊断" }).click();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("heading", { name: "本地运行状态" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "使用说明与诊断" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "本地运行状态" })).toHaveCount(
    0,
  );

  await page.getByRole("button", { name: "添加工作空间" }).first().click();
  await page
    .getByPlaceholder("选择文件夹，或输入本机路径")
    .fill(path.join(testRoot, "missing-workspace"));
  await page.getByRole("button", { name: "添加并扫描" }).click();
  await expect(page.locator(".toast-error")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "添加工作空间" }),
  ).toBeVisible();
  const retryWorkspace = await makeWorkspace("retry-workspace");
  await page.getByPlaceholder("选择文件夹，或输入本机路径").fill(retryWorkspace);
  const retryResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/workspaces") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "添加并扫描" }).click();
  const retryResponse = await retryResponsePromise;
  expect(retryResponse.ok()).toBe(true);
  await expect(page.getByRole("heading", { name: "添加工作空间" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "retry-workspace", exact: true }),
  ).toBeVisible();
  const retryStateResponse = await page.request.get("/api/state");
  const retryState = await retryStateResponse.json();
  expect(retryState.workspaces).toContain(retryWorkspace);
});

test("刷新页面时保护未保存方案草稿", async ({ page }) => {
  const originalRules = "saved candidate\n";
  const unsavedRules = `${originalRules}new draft line\n`;
  const workspace = await makeWorkspace("reload-draft", originalRules);

  await page.goto("/");
  await addWorkspace(page, workspace);
  const candidateName = page.getByLabel("方案名称");
  const originalCandidateName = await candidateName.inputValue();
  await candidateName.fill(`${originalCandidateName} draft`);
  await expect(page.getByTestId("formal-sync-impact")).toHaveText(
    "正文与磁盘文件一致；本次只改方案名称",
  );
  await candidateName.fill(originalCandidateName);
  await page.getByLabel("方案内容").fill(unsavedRules);
  await expect(page.getByTestId("formal-sync-impact")).toHaveText(
    "保存并同步将新增 1 行、删除 0 行",
  );
  if (process.env.PROMPTDOCK_FORMAL_IMPACT_SCREENSHOT_PATH) {
    await page.screenshot({
      path: process.env.PROMPTDOCK_FORMAL_IMPACT_SCREENSHOT_PATH,
    });
  }

  const beforeUnload = page.waitForEvent("dialog");
  await page.evaluate(() => {
    window.setTimeout(() => window.location.reload(), 0);
  });
  const dialog = await beforeUnload;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await expect(page.getByLabel("方案内容")).toHaveValue(unsavedRules);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    originalRules,
  );

  await page.getByRole("button", { name: "保存当前方案并同步磁盘文件" }).click();
  await expect(page.getByText(/所有更改已保存/)).toBeVisible();
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    unsavedRules,
  );
  const reloadResponse = await page.reload();
  expect(reloadResponse).not.toBeNull();
  await page.getByRole("button", { name: "reload-draft", exact: true }).click();
  await expect(page.getByLabel("方案内容")).toHaveValue(unsavedRules);
});

test("缓存方案归档与恢复保留正文、磁盘文件和历史版本", async ({ page }) => {
  const formalRules = "formal stays active\n";
  const candidateRules = "archived candidate revision\n";
  const workspace = await makeWorkspace("candidate-archive", formalRules);

  await page.goto("/");
  await addWorkspace(page, workspace);
  await page.getByRole("button", { name: "新建缓存方案" }).click();
  await page.getByPlaceholder("例如：更严格的代码审查").fill("Archive me");
  await page.getByRole("button", { name: "创建缓存方案" }).click();
  await expect(page.getByRole("heading", { name: "创建缓存方案" })).toHaveCount(0);
  await expect(page.getByLabel("方案名称")).toHaveValue("Archive me");
  await expect(
    page.getByRole("textbox", { name: "方案内容", exact: true }),
  ).toHaveValue(formalRules);
  await page
    .getByRole("textbox", { name: "方案内容", exact: true })
    .fill(candidateRules);
  await expect(
    page.getByRole("textbox", { name: "方案内容", exact: true }),
  ).toHaveValue(candidateRules);
  await expect(page.getByRole("button", { name: "保存方案" })).toBeEnabled();
  await page.getByRole("button", { name: "保存方案" }).click();
  await expect(page.getByText(/历史版本已保存/)).toBeVisible();

  const beforeArchiveResponse = await page.request.get("/api/state");
  const beforeArchive = await beforeArchiveResponse.json();
  const beforeTarget = beforeArchive.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  const savedCandidate = beforeTarget.candidates.find(
    (item: { name: string }) => item.name === "Archive me",
  );
  expect(savedCandidate).toMatchObject({ archived: false, locked: false });

  await page.getByRole("button", { name: "归档当前方案" }).click();
  await expect(page.getByLabel("方案内容")).toHaveValue(formalRules);
  await expect(
    page.getByRole("button", { name: "查看已归档方案" }),
  ).toBeEnabled();
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    formalRules,
  );

  const historyResponse = await page.request.get(
    `/api/candidates/${encodeURIComponent(savedCandidate.id)}/history?${new URLSearchParams({ path: workspace })}`,
  );
  expect(historyResponse.ok()).toBe(true);
  expect(await historyResponse.json()).toHaveLength(2);

  await page.getByRole("button", { name: "查看已归档方案" }).click();
  const archivedRow = page.getByRole("button", { name: /Archive me/ });
  await expect(archivedRow).toContainText("已归档");
  await archivedRow.click();
  if (process.env.PROMPTDOCK_ARCHIVE_SCREENSHOT_PATH) {
    await page.screenshot({
      path: process.env.PROMPTDOCK_ARCHIVE_SCREENSHOT_PATH,
    });
  }
  await expect(page.getByLabel("方案名称")).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("方案内容")).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: "只读" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "保存方案" })).toBeDisabled();
  await page.getByRole("button", { name: "恢复缓存方案" }).click();
  await expect(
    page.getByRole("button", { name: "返回当前方案" }),
  ).toBeVisible();
  await expect(page.getByLabel("方案内容")).toHaveValue(candidateRules);

  const afterRestoreResponse = await page.request.get("/api/state");
  const afterRestore = await afterRestoreResponse.json();
  const restored = afterRestore.targets
    .find((item: { path: string }) => item.path === workspace)
    .candidates.find((item: { id: string }) => item.id === savedCandidate.id);
  expect(restored).toMatchObject({ archived: false, locked: false });
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    formalRules,
  );
});

test("同名缓存方案显示短 ID 并可在列表中准确切换", async ({ page }) => {
  const formalRules = "formal variant\n";
  const firstRules = "first variant\n";
  const secondRules = "second variant\n";
  const workspace = await makeWorkspace(
    "duplicate-candidate-name",
    formalRules,
  );

  await page.goto("/");
  await addWorkspace(page, workspace);
  await page.getByRole("button", { name: "新建缓存方案" }).click();
  await page.getByPlaceholder("例如：更严格的代码审查").fill("Same label");
  await page.getByRole("button", { name: "创建缓存方案" }).click();
  await expect(page.getByRole("heading", { name: "创建缓存方案" })).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "方案内容", exact: true })
    .fill(firstRules);
  await page.getByRole("button", { name: "保存方案" }).click();
  await expect(page.getByText(/历史版本已保存/)).toBeVisible();

  await page.getByRole("button", { name: "新建缓存方案" }).click();
  await page.getByPlaceholder("例如：更严格的代码审查").fill("Same label");
  await page.getByRole("button", { name: "创建缓存方案" }).click();
  await expect(page.getByRole("heading", { name: "创建缓存方案" })).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "方案内容", exact: true })
    .fill(secondRules);
  await page.getByRole("button", { name: "保存方案" }).click();
  await expect(page.getByText(/历史版本已保存/)).toBeVisible();

  const stateResponse = await page.request.get("/api/state");
  const state = await stateResponse.json();
  const sameNamedCandidates = state.targets
    .find((item: { path: string }) => item.path === workspace)
    .candidates.filter((item: { name: string }) => item.name === "Same label");
  expect(sameNamedCandidates).toHaveLength(2);

  for (const expected of [
    { candidate: sameNamedCandidates[0], content: firstRules },
    { candidate: sameNamedCandidates[1], content: secondRules },
  ]) {
    const row = page.getByRole("button", {
      name: new RegExp(
        `Same label 缓存方案 · ${expected.candidate.id.slice(0, 7)}`,
      ),
    });
    await expect(row).toBeVisible();
    await row.click();
    await expect(
      page.getByRole("textbox", { name: "方案名称", exact: true }),
    ).toHaveValue("Same label");
    await expect(
      page.getByRole("textbox", { name: "方案内容", exact: true }),
    ).toHaveValue(expected.content);
  }
  if (process.env.PROMPTDOCK_DUPLICATE_CANDIDATE_SCREENSHOT_PATH) {
    await page.screenshot({
      path: process.env.PROMPTDOCK_DUPLICATE_CANDIDATE_SCREENSHOT_PATH,
    });
  }
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    formalRules,
  );
});

test("打开切换预览前发现外部磁盘文件修改并阻止过期预览", async ({ page }) => {
  const originalRules = "original formal rules\n";
  const candidateRules = "saved candidate rules\n";
  const externalRules = "external formal edit\n";
  const workspace = await makeWorkspace("stale-switch-preview", originalRules);
  const lockRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/candidates/lock")) {
      lockRequests.push(request.url());
    }
  });

  await page.goto("/");
  await addWorkspace(page, workspace);
  await page.getByRole("button", { name: "新建缓存方案" }).click();
  await page
    .getByPlaceholder("例如：更严格的代码审查")
    .fill("Saved alternative");
  await page.getByRole("button", { name: "创建缓存方案" }).click();
  await expect(page.getByRole("heading", { name: "创建缓存方案" })).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "方案内容", exact: true })
    .fill(candidateRules);
  await page.getByRole("button", { name: "保存方案" }).click();
  await expect(page.getByText(/历史版本已保存/)).toBeVisible();

  await writeFile(path.join(workspace, "AGENTS.md"), externalRules, "utf8");
  const freshStateResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/state"),
  );
  await page.getByRole("button", { name: "切换为正式规则" }).click();
  const freshState = await freshStateResponse;
  expect(freshState.ok()).toBe(true);
  await expect(
    page.getByRole("heading", { name: "规则文件冲突" }),
  ).toBeVisible();
  await expect(
    page.getByText("磁盘文件已发生变化，已刷新冲突状态。请先处理冲突再切换。"),
  ).toBeVisible();
  await expect(page.getByLabel("磁盘文件与当前方案的行差异")).toContainText(
    externalRules,
  );
  expect(lockRequests).toHaveLength(0);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    externalRules,
  );
});

test("只改方案名称也形成历史版本，并可按历史名称另建缓存方案", async ({ page }) => {
  const formalRules = "same candidate body\n";
  const workspace = await makeWorkspace("candidate-name-history", formalRules);

  await page.goto("/");
  await addWorkspace(page, workspace);
  await page.getByRole("button", { name: "新建缓存方案" }).click();
  await page.getByPlaceholder("例如：更严格的代码审查").fill("Original name");
  await page.getByRole("button", { name: "创建缓存方案" }).click();
  await expect(page.getByRole("heading", { name: "创建缓存方案" })).toHaveCount(0);

  await page
    .getByRole("textbox", { name: "方案名称", exact: true })
    .fill("Renamed only");
  await page.getByRole("button", { name: "保存方案" }).click();
  await expect(page.getByText(/历史版本已保存/)).toBeVisible();
  const stateBeforeHistory = await page.request.get("/api/state");
  const targetBeforeHistory = (await stateBeforeHistory.json()).targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  const candidate = targetBeforeHistory.candidates.find(
    (item: { name: string }) => item.name === "Renamed only",
  );
  await page.getByRole("button", { name: "查看历史版本" }).click();

  const revisions = page.locator(".history-revision");
  await expect(revisions).toHaveCount(2);
  await expect(page.getByText("历史版本名称：Renamed only")).toBeVisible();
  await revisions.last().click();
  await expect(page.getByText("历史版本名称：Original name")).toBeVisible();
  await page.getByRole("button", { name: "历史全文" }).click();
  await expect(page.locator(".history-preview")).toHaveText(formalRules);
  const historyDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出此历史版本" }).click();
  const historyDownload = await historyDownloadPromise;
  expect(historyDownload.suggestedFilename()).toBe("Original name.md");
  const historyExportFile = path.join(testRoot, "exported history revision.md");
  await historyDownload.saveAs(historyExportFile);
  expect(await readFile(historyExportFile, "utf8")).toBe(formalRules);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    formalRules,
  );
  const stateAfterExport = await page.request.get("/api/state");
  const targetAfterExport = (await stateAfterExport.json()).targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(
    targetAfterExport.candidates.find(
      (item: { id: string }) => item.id === candidate.id,
    ).content,
  ).toBe(formalRules);
  const historyAfterExport = await page.request.get(
    `/api/candidates/${encodeURIComponent(candidate.id)}/history?${new URLSearchParams({ path: workspace })}`,
  );
  expect(await historyAfterExport.json()).toHaveLength(2);
  if (process.env.PROMPTDOCK_NAME_HISTORY_SCREENSHOT_PATH) {
    await page.screenshot({
      path: process.env.PROMPTDOCK_NAME_HISTORY_SCREENSHOT_PATH,
    });
  }

  await page.getByRole("button", { name: "Fork 此历史版本为缓存方案" }).click();
  await expect(page.getByLabel("方案名称")).toHaveValue(
    "Original name（历史恢复）",
  );
  await expect(page.getByLabel("方案内容")).toHaveValue(formalRules);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    formalRules,
  );
});

test("升级前没有名称快照的缓存方案历史版本仍能在界面查看正文", async ({ page }) => {
  const workspace = await makeWorkspace(
    "legacy-candidate-history",
    "# Legacy rules\n",
  );
  await page.goto("/");
  await addWorkspace(page, workspace);

  const stateResponse = await page.request.get("/api/state");
  const state = await stateResponse.json();
  const target = state.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  const candidate = target.candidates[0];
  const historyDirectory = path.join(testRoot, "data", "library");
  const snapshotPath = `candidate-revisions/${candidate.id}.json`;

  await execute("git", ["rm", snapshotPath], { cwd: historyDirectory });
  await execute(
    "git",
    [
      "-c",
      "user.name=PromptDock E2E",
      "-c",
      "user.email=e2e@localhost",
      "commit",
      "-m",
      "legacy history without candidate name",
    ],
    { cwd: historyDirectory },
  );

  await page.getByRole("button", { name: "查看历史版本" }).click();
  const revisions = page.locator(".history-revision");
  await expect(revisions.first()).toBeVisible();
  await revisions.first().click();
  await expect(
    page.getByText("历史版本名称：此历史版本未单独记录名称"),
  ).toBeVisible();
  await page.getByRole("button", { name: "历史全文" }).click();
  await expect(page.locator(".history-preview")).toHaveText("# Legacy rules\n");
});

test("缓存方案查找替换只改草稿，保存当前方案后才同步磁盘文件", async ({ page }) => {
  const originalRules = "foo foo foo\n";
  const workspace = await makeWorkspace(
    "candidate-find-replace",
    originalRules,
  );

  await page.goto("/");
  await addWorkspace(page, workspace);
  await page.getByRole("button", { name: "AGENTS.md", exact: true }).click();
  await page.getByRole("button", { name: "查找替换" }).click();
  await page.getByRole("textbox", { name: "查找方案内容" }).fill("foo");
  await page.getByRole("textbox", { name: "替换为" }).fill("bar");
  await expect(page.getByText("找到 3 处")).toBeVisible();
  if (process.env.PROMPTDOCK_SCREENSHOT_PATH) {
    await page.screenshot({ path: process.env.PROMPTDOCK_SCREENSHOT_PATH });
  }

  await page.getByRole("button", { name: "下一个匹配" }).click();
  await page.getByRole("button", { name: "下一个匹配" }).click();
  await page.getByRole("button", { name: "下一个匹配" }).click();
  await page.getByRole("button", { name: "上一个匹配" }).click();
  await expect(page.getByText("第 2 / 3 处")).toBeVisible();
  await page.getByRole("button", { name: "下一个匹配" }).click();
  await expect(page.getByText("第 3 / 3 处")).toBeVisible();
  await page.getByRole("button", { name: "替换当前" }).click();
  await expect(
    page.getByRole("textbox", { name: "方案内容", exact: true }),
  ).toHaveValue("foo foo bar\n");
  await expect(page.getByText("找到 2 处")).toBeVisible();

  await page.getByRole("textbox", { name: "替换为" }).fill("baz");
  await page.getByRole("button", { name: "全部替换" }).click();
  const replacedDraft = "baz baz bar\n";
  await expect(
    page.getByRole("textbox", { name: "方案内容", exact: true }),
  ).toHaveValue(replacedDraft);
  await page.getByRole("button", { name: "关闭查找替换" }).click();
  await expect(
    page.getByRole("group", { name: "查找替换方案内容" }),
  ).toHaveCount(0);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    originalRules,
  );

  await page.getByRole("button", { name: "保存当前方案并同步磁盘文件" }).click();
  await expect(page.getByText("当前方案与磁盘文件已同步；历史版本已保存")).toBeVisible();
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    replacedDraft,
  );
});

test("当前方案保存前可预览待同步差异且不提前改文件", async ({ page }) => {
  const formalRules = "Keep this formal line\n";
  const workspace = await makeWorkspace(
    "locked-candidate-preview",
    formalRules,
  );
  const draft = `${formalRules}new behavior to review\n`;

  await page.goto("/");
  await addWorkspace(page, workspace);
  await page.getByRole("button", { name: "AGENTS.md", exact: true }).click();
  await page
    .getByRole("textbox", { name: "方案内容", exact: true })
    .fill(draft);
  await page.getByRole("button", { name: "预览待同步差异" }).click();

  await expect(
    page.getByRole("heading", { name: "方案修改同步预览" }),
  ).toBeVisible();
  await page
    .getByLabel("对比基准版本")
    .selectOption({ label: "导入的正式规则（当前方案的已保存内容）" });
  await expect(
    page.getByLabel("对比基准版本").locator("option:checked"),
  ).toHaveText("导入的正式规则（当前方案的已保存内容）");
  await expect(page.getByText(/新增 1 行 · 删除 0 行/)).toBeVisible();
  await page.getByRole("button", { name: "标记差异" }).click();
  await expect(page.locator(".candidate-compare-diff")).toContainText(
    "new behavior to review",
  );
  if (process.env.PROMPTDOCK_LOCKED_PREVIEW_SCREENSHOT_PATH) {
    await page.screenshot({
      path: process.env.PROMPTDOCK_LOCKED_PREVIEW_SCREENSHOT_PATH,
    });
  }

  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    formalRules,
  );
  const persistedState = await page.request
    .get("/api/state")
    .then((r) => r.json());
  const persistedTarget = persistedState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(persistedTarget.candidates[0].content).toBe(formalRules);

  await page.getByRole("button", { name: "关闭方案对比" }).click();
  await expect(page.getByLabel("方案内容", { exact: true })).toHaveValue(draft);
  await page.getByRole("button", { name: "保存当前方案并同步磁盘文件" }).click();
  await expect(page.getByText("当前方案与磁盘文件已同步；历史版本已保存")).toBeVisible();
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(draft);
});

test("当前方案草稿预览发现外部磁盘文件变更时阻止过期预览并保留草稿", async ({
  page,
}) => {
  const formalRules = "Original formal rules\n";
  const externalRules = "External formal update\n";
  const workspace = await makeWorkspace(
    "locked-preview-external-change",
    formalRules,
  );
  const draft = `${formalRules}unsaved candidate change\n`;

  await page.goto("/");
  await addWorkspace(page, workspace);
  await page.getByRole("button", { name: "AGENTS.md", exact: true }).click();
  await page
    .getByRole("textbox", { name: "方案内容", exact: true })
    .fill(draft);
  await writeFile(path.join(workspace, "AGENTS.md"), externalRules, "utf8");

  await page.getByRole("button", { name: "预览待同步差异" }).click();
  await expect(page.locator(".toast-error")).toContainText(
    "磁盘文件已发生变化，未打开预览",
  );
  await expect(
    page.getByRole("heading", { name: "方案修改同步预览" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "方案内容", exact: true }),
  ).toHaveValue(draft);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    externalRules,
  );

  const scanConfirmation = page.waitForEvent("dialog");
  const scanClick = page
    .getByRole("button", { name: "重新扫描当前工作空间" })
    .click();
  const confirmation = await scanConfirmation;
  expect(confirmation.message()).toContain("当前方案有未保存修改");
  await confirmation.accept();
  await scanClick;
  await expect(
    page.getByRole("heading", { name: "规则文件冲突" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "把未保存草稿放入解决稿" }).click();
  await expect(page.getByLabel("冲突解决内容")).toHaveValue(draft);
});

test("并发窗口的过期缓存方案保存被拒绝且草稿可另存为新缓存方案", async ({
  page,
  context,
}) => {
  const originalRules = "# Shared rules\nKeep the formal file safe.\n";
  const workspace = await makeWorkspace(
    "concurrent-candidate-save",
    originalRules,
  );
  await page.goto("/");
  await addWorkspace(page, workspace);

  const initialResponse = await page.request.get("/api/state");
  const initialState = await initialResponse.json();
  const initialTarget = initialState.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  const lockedCandidateId = initialTarget.candidates.find(
    (item: { locked: boolean }) => item.locked,
  ).id;
  const historyUrl = `/api/candidates/${encodeURIComponent(lockedCandidateId)}/history?${new URLSearchParams({ path: workspace })}`;

  const secondPage = await context.newPage();
  await secondPage.goto("/");
  await addWorkspace(secondPage, workspace);

  const firstWindowRules = `${originalRules}\nSaved in the first window.\n`;
  const staleDraft = `${originalRules}\nUncommitted draft from the second window.\n`;
  await page.getByLabel("方案内容", { exact: true }).fill(firstWindowRules);
  await secondPage.getByLabel("方案内容", { exact: true }).fill(staleDraft);

  await page.getByRole("button", { name: "保存当前方案并同步磁盘文件" }).click();
  await expect(page.getByText("当前方案与磁盘文件已同步；历史版本已保存")).toBeVisible();
  const historyAfterFirstSave = await page.request.get(historyUrl);
  const savedHistory = await historyAfterFirstSave.json();
  expect(savedHistory).toHaveLength(2);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    firstWindowRules,
  );

  await secondPage.getByRole("button", { name: "保存当前方案并同步磁盘文件" }).click();
  await expect(secondPage.locator(".toast-error")).toContainText(
    "此缓存方案已在其他窗口保存新内容",
  );
  await expect(secondPage.getByLabel("方案内容", { exact: true })).toHaveValue(
    staleDraft,
  );
  const historyAfterRejectedSave = await page.request.get(historyUrl);
  expect(await historyAfterRejectedSave.json()).toHaveLength(
    savedHistory.length,
  );
  const stateAfterRejectedSave = await page.request.get("/api/state");
  const targetAfterRejectedSave = (
    await stateAfterRejectedSave.json()
  ).targets.find((item: { path: string }) => item.path === workspace);
  expect(
    targetAfterRejectedSave.candidates.find(
      (item: { id: string }) => item.id === lockedCandidateId,
    ).content,
  ).toBe(firstWindowRules);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    firstWindowRules,
  );

  await secondPage.getByRole("button", { name: "新建缓存方案" }).click();
  await secondPage.getByLabel("新方案名称").fill("Second window draft");
  await secondPage.getByRole("button", { name: "创建缓存方案" }).click();
  await expect(
    secondPage.getByText("缓存方案已创建并记录到本地 Git"),
  ).toBeVisible();
  await expect(secondPage.getByLabel("方案名称", { exact: true })).toHaveValue(
    "Second window draft",
  );
  await expect(secondPage.getByLabel("方案内容", { exact: true })).toHaveValue(
    staleDraft,
  );
  const response = await secondPage.request.get("/api/state");
  const state = await response.json();
  const target = state.targets.find(
    (item: { path: string }) => item.path === workspace,
  );
  expect(
    target.candidates.some(
      (item: { name: string; content: string }) =>
        item.name === "Second window draft" && item.content === staleDraft,
    ),
  ).toBe(true);
  expect(await readFile(path.join(workspace, "AGENTS.md"), "utf8")).toBe(
    firstWindowRules,
  );
});
